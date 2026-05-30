-- Function: get_savings_breakdown
-- Purpose:  Headline savings table for the Flight Insights page.
--           Returns baseline vs smart price, total yield, and one entry per
--           active saving lever. Every other Flight Insights section is detail
--           behind these numbers.
--
-- Smart price:
--   Scans all outbound + return date pairs in fare_snapshots for this destination,
--   run, and matched composition within the allowed date windows for the given
--   trip type. Picks the pair with the lowest assembled price. Winning dates
--   returned as best_outbound_date / best_return_date.
--
-- Trip types:
--   'circuit' — 7–10 nights, depart up to 4 days before window start.
--   'city'    — 3–4 nights, depart any time in window.
--
-- Composition matching:
--   Input mapped to nearest of (1A+1C, 2A+1C, 2A+2C, 2A+1inf). Never errors.

DROP FUNCTION IF EXISTS get_savings_breakdown(text, text, date, date, smallint, smallint, smallint, smallint);

CREATE OR REPLACE FUNCTION get_savings_breakdown(
  p_destination_slug     text,
  p_school_urn           text,
  p_window_start         date,
  p_window_end           date,
  p_trip_type            text,
  p_adults               smallint,
  p_children             smallint,
  p_infants              smallint
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
  v_postcode_district text;
  v_borough           text;

  -- Matched composition
  v_adults   smallint;
  v_children smallint;
  v_infants  smallint;

  -- Latest run
  v_run_id uuid;

  -- Smart price — best outbound+return pair found internally
  v_best_outbound_date  date;
  v_best_return_date    date;
  v_smart               numeric;

  -- Core prices
  v_baseline  numeric;
  v_yield     numeric;

  -- Fine-aware yield
  v_fine_result jsonb;
  v_fine        numeric;
  v_net_yield   numeric;

  -- Levers accumulator
  v_levers jsonb := '[]'::jsonb;

  -- Lever 1 — airport arbitrage
  v_lhr_fare      numeric;
  v_lhr_transport numeric;
  v_lhr_net       numeric;
  v_best_ap_iata  text;
  v_best_ap_net   numeric;

  -- Lever 2 — date arbitrage
  v_official_assembled  numeric;
  v_is_inset_day        boolean := false;

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

  -- Trip type date ranges
  v_dep_earliest date;
  v_dep_latest   date;
  v_ret_earliest date;
  v_ret_latest   date;
  v_min_nights   smallint;
  v_max_nights   smallint;
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

  -- ── 2. School metadata ──────────────────────────────────────────────────────

  SELECT postcode_district, borough
    INTO v_postcode_district, v_borough
    FROM all_schools
   WHERE urn = p_school_urn;

  -- ── Trip type date ranges ───────────────────────────────────────────────────

  IF p_trip_type = 'circuit' THEN
    v_dep_earliest := p_window_start - 4;
    v_dep_latest   := p_window_start;
    v_min_nights   := 7;
    v_max_nights   := 10;
  ELSE -- city
    v_dep_earliest := p_window_start - 4;
    v_dep_latest   := p_window_end;
    v_min_nights   := 3;
    v_max_nights   := 4;
  END IF;

  v_ret_earliest := v_dep_earliest + v_min_nights;
  v_ret_latest   := v_dep_latest + v_max_nights;

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

  -- ── 5. Baseline price ───────────────────────────────────────────────────────

  SELECT party_total_gbp
    INTO v_baseline
    FROM baseline_snapshots
   WHERE destination_slug = p_destination_slug
     AND adults           = v_adults
     AND children         = v_children
     AND infants          = v_infants
   LIMIT 1;

  -- ── 6. Smart price: find cheapest outbound + return pair ─────────────────────

  SELECT
    dep_date,
    ret_date,
    out_fare + ret_fare
  INTO v_best_outbound_date, v_best_return_date, v_smart
  FROM (
    SELECT
      fs_out.departure_date AS dep_date,
      fs_ret.departure_date AS ret_date,
      MIN(fs_out.party_total_gbp) AS out_fare,
      MIN(fs_ret.party_total_gbp) AS ret_fare
    FROM fare_snapshots fs_out
    JOIN fare_snapshots fs_ret
      ON fs_ret.run_id           = v_run_id
     AND fs_ret.origin_iata       = ANY(v_dest_airports)
     AND fs_ret.destination_iata  IN ('LHR','LGW','STN','LTN','LCY')
     AND fs_ret.adults   = v_adults
     AND fs_ret.children = v_children
     AND fs_ret.infants  = v_infants
     AND fs_ret.departure_date BETWEEN v_ret_earliest AND v_ret_latest
     AND (fs_ret.departure_date - fs_out.departure_date) BETWEEN v_min_nights AND v_max_nights
    WHERE fs_out.run_id           = v_run_id
      AND fs_out.origin_iata      IN ('LHR','LGW','STN','LTN','LCY')
      AND fs_out.destination_iata  = ANY(v_dest_airports)
      AND fs_out.adults   = v_adults
      AND fs_out.children = v_children
      AND fs_out.infants  = v_infants
      AND fs_out.departure_date BETWEEN v_dep_earliest AND v_dep_latest
    GROUP BY fs_out.departure_date, fs_ret.departure_date
  ) pairs
  ORDER BY out_fare + ret_fare ASC
  LIMIT 1;

  v_yield := CASE
    WHEN v_baseline IS NOT NULL AND v_smart IS NOT NULL
    THEN v_baseline - v_smart
    ELSE NULL
  END;

  -- ── Fine-aware yield ────────────────────────────────────────────────────────

  v_fine_result := calculate_absence_fine(
    v_best_outbound_date,
    v_best_return_date,
    p_window_start,
    p_window_end,
    p_school_urn,
    p_adults,
    p_children
  );

  v_fine      := (v_fine_result->>'fine_gbp')::numeric;
  v_net_yield := CASE
    WHEN v_yield IS NOT NULL
    THEN v_yield - COALESCE(v_fine, 0)
    ELSE NULL
  END;

  -- ══ LEVER 1: London airport arbitrage ═══════════════════════════════════════
  -- Net-of-transport cost per airport = flight fare + public transport cost.
  -- Transport cost from district_airport_transit; null when data absent (sorts last).
  -- Saving = LHR net − best alternative net. Only fires when a non-LHR airport wins.

  SELECT MIN(fs.party_total_gbp)
    INTO v_lhr_fare
    FROM fare_snapshots fs
   WHERE fs.run_id           = v_run_id
     AND fs.origin_iata      = 'LHR'
     AND fs.destination_iata  = ANY(v_dest_airports)
     AND fs.departure_date   = v_best_outbound_date
     AND fs.adults           = v_adults
     AND fs.children         = v_children
     AND fs.infants          = v_infants;

  SELECT CASE
           WHEN transit_offpeak_fare_pence IS NOT NULL
           THEN transit_offpeak_fare_pence / 100.0
           ELSE NULL
         END
    INTO v_lhr_transport
    FROM district_airport_transit
   WHERE postcode_district = v_postcode_district
     AND airport_code      = 'LHR'
   LIMIT 1;

  v_lhr_net := v_lhr_fare + v_lhr_transport;

  SELECT airport_iata, net_total
    INTO v_best_ap_iata, v_best_ap_net
    FROM (
      SELECT
        fares.origin_iata                    AS airport_iata,
        fares.min_fare + CASE
                           WHEN dat.transit_offpeak_fare_pence IS NOT NULL
                           THEN dat.transit_offpeak_fare_pence / 100.0
                           ELSE NULL
                         END                 AS net_total
      FROM (
        SELECT fs.origin_iata, MIN(fs.party_total_gbp) AS min_fare
          FROM fare_snapshots fs
         WHERE fs.run_id           = v_run_id
           AND fs.origin_iata      IN ('LHR','LGW','STN','LTN','LCY')
           AND fs.destination_iata  = ANY(v_dest_airports)
           AND fs.departure_date   = v_best_outbound_date
           AND fs.adults           = v_adults
           AND fs.children         = v_children
           AND fs.infants          = v_infants
         GROUP BY fs.origin_iata
      ) fares
      LEFT JOIN district_airport_transit dat
             ON dat.postcode_district = v_postcode_district
            AND dat.airport_code      = fares.origin_iata
    ) ranked
   ORDER BY net_total ASC NULLS LAST
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
  -- Compares the smart trip (cheapest found internally) against the assembled
  -- fare on the official window start (p_window_start + v_min_nights).
  -- Lever fires only when smart date is cheaper than official start.
  -- is_borough_specific = true when the smart outbound date is an inset day.

  SELECT EXISTS(
    SELECT 1 FROM school_inset_days
     WHERE urn  = p_school_urn
       AND date = v_best_outbound_date
  ) INTO v_is_inset_day;

  IF v_smart IS NOT NULL AND v_best_outbound_date IS DISTINCT FROM p_window_start THEN

    SELECT out_fare + ret_fare
      INTO v_official_assembled
      FROM (
        SELECT
          (SELECT MIN(party_total_gbp)
             FROM fare_snapshots
            WHERE run_id           = v_run_id
              AND origin_iata      IN ('LHR','LGW','STN','LTN','LCY')
              AND destination_iata  = ANY(v_dest_airports)
              AND departure_date   = p_window_start
              AND adults   = v_adults
              AND children = v_children
              AND infants  = v_infants
          ) AS out_fare,
          (SELECT MIN(party_total_gbp)
             FROM fare_snapshots
            WHERE run_id           = v_run_id
              AND origin_iata       = ANY(v_dest_airports)
              AND destination_iata  IN ('LHR','LGW','STN','LTN','LCY')
              AND departure_date   = p_window_start + v_min_nights
              AND adults   = v_adults
              AND children = v_children
              AND infants  = v_infants
          ) AS ret_fare
      ) official;

    IF v_official_assembled IS NOT NULL AND v_official_assembled > v_smart THEN
      v_levers := v_levers || jsonb_build_object(
        'label',              'Departure day ('
                               || to_char(v_best_outbound_date, 'Mon DD')
                               || ' vs ' || to_char(p_window_start, 'Mon DD') || ')',
        'winner',             to_char(v_best_outbound_date, 'Mon DD'),
        'saving',             ROUND(v_official_assembled - v_smart, 2),
        'above_threshold',    (v_official_assembled - v_smart) >= 30,
        'is_borough_specific', v_is_inset_day
      );
    END IF;
  END IF;

  -- ══ LEVER 3: Open-jaw routing (circuit destinations only) ═══════════════════
  -- Open-jaw best = v_smart (independently cheapest outbound + return airports).
  -- Symmetric best = cheapest price when both legs use the same airport.
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
               AND fs.departure_date   = v_best_outbound_date
               AND fs.adults = v_adults AND fs.children = v_children AND fs.infants = v_infants
          ) AS out_fare,
          (
            SELECT MIN(fs.party_total_gbp) FROM fare_snapshots fs
             WHERE fs.run_id           = v_run_id
               AND fs.origin_iata       = da.iata_code
               AND fs.destination_iata  IN ('LHR','LGW','STN','LTN','LCY')
               AND fs.departure_date   = v_best_return_date
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

  IF v_adults = 2 AND v_children = 2 AND v_infants = 0 AND v_smart IS NOT NULL THEN
    SELECT MIN(party_total_gbp)
      INTO v_split_out
      FROM fare_snapshots
     WHERE run_id           = v_run_id
       AND origin_iata      IN ('LHR','LGW','STN','LTN','LCY')
       AND destination_iata  = ANY(v_dest_airports)
       AND departure_date   = v_best_outbound_date
       AND adults = 1 AND children = 1 AND infants = 0;

    SELECT MIN(party_total_gbp)
      INTO v_split_ret
      FROM fare_snapshots
     WHERE run_id           = v_run_id
       AND origin_iata       = ANY(v_dest_airports)
       AND destination_iata  IN ('LHR','LGW','STN','LTN','LCY')
       AND departure_date   = v_best_return_date
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
  -- Net total = flight fare + transfer_cost_gbp; CASE handles null explicitly.
  -- Saving = primary_net − secondary_net. Only fires when secondary wins.

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
         AND fs.departure_date   = v_best_outbound_date
         AND fs.adults           = v_adults
         AND fs.children         = v_children
         AND fs.infants          = v_infants;

      SELECT transfer_cost_gbp
        INTO v_primary_transfer
        FROM destination_airports
       WHERE destination_id = v_dest_id AND iata_code = v_primary_iata;

      FOR v_rec IN
        SELECT
          da.iata_code,
          da.transfer_cost_gbp                 AS xfer,
          da.transfer_cost_gbp IS NULL         AS xfer_excluded,
          MIN(fs.party_total_gbp)              AS fare
        FROM destination_airports da
        JOIN fare_snapshots fs
          ON fs.destination_iata  = da.iata_code
         AND fs.run_id            = v_run_id
         AND fs.origin_iata       IN ('LHR','LGW','STN','LTN','LCY')
         AND fs.departure_date    = v_best_outbound_date
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
               > (v_rec.fare + COALESCE(v_rec.xfer, 0))
        THEN
          v_levers := v_levers || jsonb_build_object(
            'label',              'Destination airport (' || v_rec.iata_code
                                   || ' vs ' || v_primary_iata || ')',
            'winner',             v_rec.iata_code,
            'saving',             ROUND(
                                    CASE
                                      WHEN v_rec.xfer IS NOT NULL
                                      THEN (v_primary_fare + COALESCE(v_primary_transfer, 0))
                                           - (v_rec.fare + v_rec.xfer)
                                      ELSE (v_primary_fare + COALESCE(v_primary_transfer, 0))
                                           - v_rec.fare
                                    END,
                                    2
                                  ),
            'above_threshold',    (
                                    CASE
                                      WHEN v_rec.xfer IS NOT NULL
                                      THEN (v_primary_fare + COALESCE(v_primary_transfer, 0))
                                           - (v_rec.fare + v_rec.xfer)
                                      ELSE (v_primary_fare + COALESCE(v_primary_transfer, 0))
                                           - v_rec.fare
                                    END
                                  ) >= 30,
            'transfer_cost_excluded', v_rec.xfer_excluded,
            'is_borough_specific', false
          );
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- ── Return ──────────────────────────────────────────────────────────────────

  RETURN jsonb_build_object(
    'best_outbound_date',     v_best_outbound_date,
    'best_return_date',       v_best_return_date,
    'baseline_price',         v_baseline,
    'smart_price',            v_smart,
    'total_yield',            v_yield,
    'fine_gbp',               v_fine,
    'fine_is_estimate',       true,
    'net_yield',              v_net_yield,
    'requires_absence',       (v_fine_result->>'requires_absence')::boolean,
    'departure_absence_days', (v_fine_result->>'departure_absence_days')::smallint,
    'return_absence_days',    (v_fine_result->>'return_absence_days')::smallint,
    'levers',                 v_levers
  );

END;
$$;
