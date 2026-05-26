-- Function: get_savings_breakdown
-- Purpose:  Headline savings table for the Flight Insights page.
--           Returns baseline vs smart price, total yield, and one entry per
--           active saving lever. Every other Flight Insights section is detail
--           behind these numbers.
--
-- Composition matching:
--   Input composition is mapped to the nearest of the 4 snapshot compositions
--   (1A+1C, 2A+1C, 2A+2C, 2A+1inf) by minimising total pax distance. Never errors.
--
-- Term-date fallback (Lever 2):
--   Mirrors the two-tier pattern in pages/api/term-dates.js and
--   pages/api/borough-dates.js: school_term_dates first, then borough_term_dates.
--
-- school_airport_transit duration fields (not used in this function, but noted
-- here for all callers of that table):
--   cheapest_duration_secs — stored in MINUTES despite the name; use as-is for display.
--   drive_duration_secs    — stored in SECONDS; divide by 60 for display in minutes.

CREATE OR REPLACE FUNCTION get_savings_breakdown(
  p_destination_slug text,
  p_school_urn       text,
  p_outbound_date    date,
  p_return_date      date,
  p_adults           smallint,
  p_children         smallint,
  p_infants          smallint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  -- Destination
  v_dest_id       uuid;
  v_dest_type     text;
  v_dest_airports text[];

  -- School
  v_postcode  text;
  v_borough   text;

  -- Matched composition
  v_adults   smallint;
  v_children smallint;
  v_infants  smallint;

  -- Latest run
  v_run_id uuid;

  -- Core prices
  v_baseline numeric;
  v_best_out numeric;
  v_best_ret numeric;
  v_smart    numeric;
  v_yield    numeric;

  -- Levers accumulator
  v_levers jsonb := '[]'::jsonb;

  -- Lever 1 — airport arbitrage
  v_lhr_fare      numeric;
  v_lhr_transport numeric;
  v_lhr_net       numeric;
  v_best_ap_iata  text;
  v_best_ap_net   numeric;

  -- Lever 2 — date arbitrage
  v_official_start date;
  v_is_inset_day   boolean := false;
  v_official_fare  numeric;

  -- Lever 3 — open-jaw
  v_sym_best numeric;

  -- Lever 4 — bucket split
  v_split_out numeric;
  v_split_ret numeric;

  -- Lever 5 — nearby destination airport
  v_primary_iata     text;
  v_primary_fare     numeric;
  v_primary_transfer numeric;
  v_rec              record;
BEGIN

  -- ── 1. Resolve destination ──────────────────────────────────────────────────

  SELECT id, type::text
    INTO v_dest_id, v_dest_type
    FROM destinations
   WHERE slug = p_destination_slug;

  IF v_dest_id IS NULL THEN
    RETURN jsonb_build_object('error', 'destination not found: ' || p_destination_slug);
  END IF;

  SELECT array_agg(iata_code)
    INTO v_dest_airports
    FROM destination_airports
   WHERE destination_id = v_dest_id
     AND excluded = false;

  IF v_dest_airports IS NULL OR array_length(v_dest_airports, 1) = 0 THEN
    RETURN jsonb_build_object('error', 'no airport pool for: ' || p_destination_slug);
  END IF;

  -- ── 2. School metadata (postcode drives transit lookup; borough drives fallback) ─

  SELECT postcode, borough
    INTO v_postcode, v_borough
    FROM all_schools
   WHERE urn = p_school_urn;

  -- ── 3. Composition matching ─────────────────────────────────────────────────

  SELECT c.adults, c.children, c.infants
    INTO v_adults, v_children, v_infants
    FROM (VALUES
      (1::smallint, 1::smallint, 0::smallint),
      (2::smallint, 1::smallint, 0::smallint),
      (2::smallint, 2::smallint, 0::smallint),
      (2::smallint, 0::smallint, 1::smallint)
    ) AS c(adults, children, infants)
   ORDER BY abs(c.adults   - p_adults)
          + abs(c.children - p_children)
          + abs(c.infants  - p_infants)
   LIMIT 1;

  -- ── 4. Latest completed cross-sectional run ─────────────────────────────────

  SELECT id
    INTO v_run_id
    FROM snapshot_runs
   WHERE run_type    = 'cross_sectional'
     AND completed_at IS NOT NULL
   ORDER BY completed_at DESC
   LIMIT 1;

  IF v_run_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no completed cross-sectional run found');
  END IF;

  -- ── 5. Baseline price (LHR, Saturday, cheapest round-trip, matched composition) ─

  SELECT party_total_gbp
    INTO v_baseline
    FROM baseline_snapshots
   WHERE destination_slug = p_destination_slug
     AND adults           = v_adults
     AND children         = v_children
     AND infants          = v_infants
   LIMIT 1;

  -- ── 6. Best outbound fare (any LDN → any pool airport, matched date + comp) ─

  SELECT MIN(party_total_gbp)
    INTO v_best_out
    FROM fare_snapshots
   WHERE run_id           = v_run_id
     AND origin_iata      IN ('LHR','LGW','STN','LTN','LCY')
     AND destination_iata  = ANY(v_dest_airports)
     AND departure_date   = p_outbound_date
     AND adults           = v_adults
     AND children         = v_children
     AND infants          = v_infants;

  -- ── 7. Best return fare (any pool airport → any LDN, matched date + comp) ───

  SELECT MIN(party_total_gbp)
    INTO v_best_ret
    FROM fare_snapshots
   WHERE run_id           = v_run_id
     AND origin_iata       = ANY(v_dest_airports)
     AND destination_iata  IN ('LHR','LGW','STN','LTN','LCY')
     AND departure_date   = p_return_date
     AND adults           = v_adults
     AND children         = v_children
     AND infants          = v_infants;

  -- ── 8. Smart price + total yield ────────────────────────────────────────────

  v_smart := CASE
    WHEN v_best_out IS NOT NULL AND v_best_ret IS NOT NULL
    THEN v_best_out + v_best_ret
    ELSE NULL
  END;

  v_yield := CASE
    WHEN v_baseline IS NOT NULL AND v_smart IS NOT NULL
    THEN v_baseline - v_smart
    ELSE NULL
  END;

  -- ══ LEVER 1: London airport arbitrage ═══════════════════════════════════════
  -- Net-of-transport cost per airport = flight fare + public transport cost.
  -- Transport cost sourced from school_airport_transit (cheapest_fare_pence / 100).
  -- Saving = LHR net − best alternative net. Only surfaced when a non-LHR airport wins.

  SELECT MIN(fs.party_total_gbp)
    INTO v_lhr_fare
    FROM fare_snapshots fs
   WHERE fs.run_id           = v_run_id
     AND fs.origin_iata      = 'LHR'
     AND fs.destination_iata  = ANY(v_dest_airports)
     AND fs.departure_date   = p_outbound_date
     AND fs.adults           = v_adults
     AND fs.children         = v_children
     AND fs.infants          = v_infants;

  SELECT cheapest_fare_pence / 100.0
    INTO v_lhr_transport
    FROM school_airport_transit
   WHERE postcode    = v_postcode
     AND airport_iata = 'LHR'
   LIMIT 1;

  v_lhr_net := v_lhr_fare + COALESCE(v_lhr_transport, 0);

  SELECT airport_iata, net_total
    INTO v_best_ap_iata, v_best_ap_net
    FROM (
      SELECT
        fares.origin_iata                                              AS airport_iata,
        fares.min_fare + COALESCE(sat.cheapest_fare_pence / 100.0, 0) AS net_total
      FROM (
        SELECT fs.origin_iata, MIN(fs.party_total_gbp) AS min_fare
          FROM fare_snapshots fs
         WHERE fs.run_id           = v_run_id
           AND fs.origin_iata      IN ('LHR','LGW','STN','LTN','LCY')
           AND fs.destination_iata  = ANY(v_dest_airports)
           AND fs.departure_date   = p_outbound_date
           AND fs.adults           = v_adults
           AND fs.children         = v_children
           AND fs.infants          = v_infants
         GROUP BY fs.origin_iata
      ) fares
      LEFT JOIN school_airport_transit sat
             ON sat.postcode    = v_postcode
            AND sat.airport_iata = fares.origin_iata
    ) ranked
   ORDER BY net_total ASC
   LIMIT 1;

  IF v_lhr_net IS NOT NULL
     AND v_best_ap_net IS NOT NULL
     AND v_best_ap_iata IS DISTINCT FROM 'LHR'
  THEN
    v_levers := v_levers || jsonb_build_object(
      'label',              'London airport (' || v_best_ap_iata || ' vs LHR)',
      'winner',             v_best_ap_iata,
      'saving',             ROUND(v_lhr_net - v_best_ap_net, 2),
      'above_threshold',    (v_lhr_net - v_best_ap_net) >= 30,
      'is_borough_specific', false
    );
  END IF;

  -- ══ LEVER 2: Departure-day arbitrage ════════════════════════════════════════
  -- Official break start via two-tier fallback: school_term_dates → borough_term_dates.
  -- Mirrors pages/api/term-dates.js + pages/api/borough-dates.js on the landing page.
  -- Saving = fare on official start − fare on p_outbound_date (user flies earlier).
  -- is_borough_specific = true when p_outbound_date is a school inset day.

  SELECT start_date
    INTO v_official_start
    FROM school_term_dates
   WHERE urn        = p_school_urn
     AND start_date BETWEEN p_outbound_date - 14 AND p_outbound_date + 14
   ORDER BY abs(start_date - p_outbound_date) ASC
   LIMIT 1;

  IF v_official_start IS NULL AND v_borough IS NOT NULL THEN
    SELECT start_date
      INTO v_official_start
      FROM borough_term_dates
     WHERE borough    = v_borough
       AND start_date BETWEEN p_outbound_date - 14 AND p_outbound_date + 14
     ORDER BY abs(start_date - p_outbound_date) ASC
     LIMIT 1;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM school_inset_days
     WHERE urn  = p_school_urn
       AND date = p_outbound_date
  ) INTO v_is_inset_day;

  IF v_official_start IS NOT NULL AND v_official_start <> p_outbound_date THEN
    SELECT MIN(party_total_gbp)
      INTO v_official_fare
      FROM fare_snapshots
     WHERE run_id           = v_run_id
       AND origin_iata      IN ('LHR','LGW','STN','LTN','LCY')
       AND destination_iata  = ANY(v_dest_airports)
       AND departure_date   = v_official_start
       AND adults           = v_adults
       AND children         = v_children
       AND infants          = v_infants;

    IF v_official_fare IS NOT NULL AND v_best_out IS NOT NULL THEN
      v_levers := v_levers || jsonb_build_object(
        'label',              'Departure day ('
                               || to_char(p_outbound_date, 'Mon DD')
                               || ' vs ' || to_char(v_official_start, 'Mon DD') || ')',
        'winner',             to_char(p_outbound_date, 'Mon DD'),
        'saving',             ROUND(v_official_fare - v_best_out, 2),
        'above_threshold',    (v_official_fare - v_best_out) >= 30,
        'is_borough_specific', v_is_inset_day
      );
    END IF;
  END IF;

  -- ══ LEVER 3: Open-jaw routing (circuit destinations only) ═══════════════════
  -- Open-jaw best = v_smart (best outbound to any pool airport + best return from
  -- any pool airport, independently chosen — already the optimum mix).
  -- Symmetric best = cheapest price when outbound and return use the same airport.
  -- Saving = symmetric_best − open_jaw_best (positive = open-jaw wins).

  IF v_dest_type = 'circuit'
     AND array_length(v_dest_airports, 1) > 1
     AND v_smart IS NOT NULL
  THEN
    SELECT MIN(sym.out_fare + sym.ret_fare)
      INTO v_sym_best
      FROM (
        SELECT
          da.iata_code,
          (
            SELECT MIN(fs.party_total_gbp) FROM fare_snapshots fs
             WHERE fs.run_id           = v_run_id
               AND fs.origin_iata      IN ('LHR','LGW','STN','LTN','LCY')
               AND fs.destination_iata  = da.iata_code
               AND fs.departure_date   = p_outbound_date
               AND fs.adults = v_adults AND fs.children = v_children AND fs.infants = v_infants
          ) AS out_fare,
          (
            SELECT MIN(fs.party_total_gbp) FROM fare_snapshots fs
             WHERE fs.run_id           = v_run_id
               AND fs.origin_iata       = da.iata_code
               AND fs.destination_iata  IN ('LHR','LGW','STN','LTN','LCY')
               AND fs.departure_date   = p_return_date
               AND fs.adults = v_adults AND fs.children = v_children AND fs.infants = v_infants
          ) AS ret_fare
        FROM destination_airports da
        WHERE da.destination_id = v_dest_id AND da.excluded = false
      ) sym
     WHERE sym.out_fare IS NOT NULL AND sym.ret_fare IS NOT NULL;

    IF v_sym_best IS NOT NULL AND v_sym_best > v_smart THEN
      v_levers := v_levers || jsonb_build_object(
        'label',              'Open-jaw routing',
        'winner',             'Mixed airports',
        'saving',             ROUND(v_sym_best - v_smart, 2),
        'above_threshold',    (v_sym_best - v_smart) >= 30,
        'is_borough_specific', false
      );
    END IF;
  END IF;

  -- ══ LEVER 4: Bucket split (2A+2C composition only) ══════════════════════════
  -- Checks whether booking as 2×(1A+1C) beats 1×(2A+2C).
  -- Both compositions are always collected in the snapshot run, so no extra API calls.

  IF v_adults = 2 AND v_children = 2 AND v_infants = 0 AND v_smart IS NOT NULL THEN
    SELECT MIN(party_total_gbp)
      INTO v_split_out
      FROM fare_snapshots
     WHERE run_id           = v_run_id
       AND origin_iata      IN ('LHR','LGW','STN','LTN','LCY')
       AND destination_iata  = ANY(v_dest_airports)
       AND departure_date   = p_outbound_date
       AND adults = 1 AND children = 1 AND infants = 0;

    SELECT MIN(party_total_gbp)
      INTO v_split_ret
      FROM fare_snapshots
     WHERE run_id           = v_run_id
       AND origin_iata       = ANY(v_dest_airports)
       AND destination_iata  IN ('LHR','LGW','STN','LTN','LCY')
       AND departure_date   = p_return_date
       AND adults = 1 AND children = 1 AND infants = 0;

    IF v_split_out IS NOT NULL
       AND v_split_ret IS NOT NULL
       AND v_smart > (v_split_out + v_split_ret) * 2
    THEN
      v_levers := v_levers || jsonb_build_object(
        'label',              'Bucket split (2×1A+1C vs 1×2A+2C)',
        'winner',             '2×1A+1C',
        'saving',             ROUND(v_smart - (v_split_out + v_split_ret) * 2, 2),
        'above_threshold',    (v_smart - (v_split_out + v_split_ret) * 2) >= 30,
        'is_borough_specific', false
      );
    END IF;
  END IF;

  -- ══ LEVER 5: Nearby destination airport ═════════════════════════════════════
  -- Only when the destination pool has multiple airports.
  -- Primary = airport with most rows in fare_snapshots for this run (most-served).
  -- Net total = flight fare + transfer_cost_gbp (destination-side ground transport).
  -- transfer_cost_gbp nullable — treated as 0 when absent.
  -- Saving = primary_net − secondary_net. Only surfaced when secondary wins.

  IF array_length(v_dest_airports, 1) > 1 THEN
    SELECT fs.destination_iata
      INTO v_primary_iata
      FROM fare_snapshots fs
     WHERE fs.run_id           = v_run_id
       AND fs.origin_iata      IN ('LHR','LGW','STN','LTN','LCY')
       AND fs.destination_iata  = ANY(v_dest_airports)
     GROUP BY fs.destination_iata
     ORDER BY COUNT(*) DESC
     LIMIT 1;

    IF v_primary_iata IS NOT NULL THEN
      SELECT MIN(fs.party_total_gbp)
        INTO v_primary_fare
        FROM fare_snapshots fs
       WHERE fs.run_id           = v_run_id
         AND fs.origin_iata      IN ('LHR','LGW','STN','LTN','LCY')
         AND fs.destination_iata  = v_primary_iata
         AND fs.departure_date   = p_outbound_date
         AND fs.adults           = v_adults
         AND fs.children         = v_children
         AND fs.infants          = v_infants;

      SELECT COALESCE(transfer_cost_gbp, 0)
        INTO v_primary_transfer
        FROM destination_airports
       WHERE destination_id = v_dest_id AND iata_code = v_primary_iata;

      FOR v_rec IN
        SELECT
          da.iata_code,
          COALESCE(da.transfer_cost_gbp, 0) AS xfer,
          MIN(fs.party_total_gbp)            AS fare
        FROM destination_airports da
        JOIN fare_snapshots fs
          ON fs.destination_iata  = da.iata_code
         AND fs.run_id            = v_run_id
         AND fs.origin_iata       IN ('LHR','LGW','STN','LTN','LCY')
         AND fs.departure_date    = p_outbound_date
         AND fs.adults            = v_adults
         AND fs.children          = v_children
         AND fs.infants           = v_infants
        WHERE da.destination_id = v_dest_id
          AND da.excluded       = false
          AND da.iata_code      <> v_primary_iata
        GROUP BY da.iata_code, da.transfer_cost_gbp
      LOOP
        IF v_primary_fare IS NOT NULL
           AND (v_primary_fare + COALESCE(v_primary_transfer, 0))
               > (v_rec.fare + v_rec.xfer)
        THEN
          v_levers := v_levers || jsonb_build_object(
            'label',              'Destination airport (' || v_rec.iata_code
                                   || ' vs ' || v_primary_iata || ')',
            'winner',             v_rec.iata_code,
            'saving',             ROUND(
                                    (v_primary_fare + COALESCE(v_primary_transfer, 0))
                                    - (v_rec.fare + v_rec.xfer),
                                    2
                                  ),
            'above_threshold',    (
                                    (v_primary_fare + COALESCE(v_primary_transfer, 0))
                                    - (v_rec.fare + v_rec.xfer)
                                  ) >= 30,
            'is_borough_specific', false
          );
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- ── Return ──────────────────────────────────────────────────────────────────

  RETURN jsonb_build_object(
    'baseline_price', v_baseline,
    'smart_price',    v_smart,
    'total_yield',    v_yield,
    'levers',         v_levers
  );

END;
$$;
