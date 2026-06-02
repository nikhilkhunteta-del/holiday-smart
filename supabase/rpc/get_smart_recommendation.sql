-- Function: get_smart_recommendation
-- Purpose:  Single best booking recommendation for the Flight Insights page.
--           Searches all valid date combinations for the trip type, pairs outbound
--           and return carriers (same-carrier preferred; cheapest-carrier fallback),
--           applies ancillary costs (cabin bags, checked bags, seat selection) with
--           per-leg bundle optimisation, deducts term-time fines, and returns the
--           date × carrier combination with the highest net saving vs the baseline.
--
-- Window resolution:
--   Derives holiday window from fare data date range (mirrors get_compliance_scenarios).
--   Falls back school_term_dates → borough_term_dates.
--
-- Carrier pairing:
--   Mirrors get_allin_flight_cost carrier_pairs CTE verbatim, extended across all
--   valid date pairs. Same carrier return preferred; cheapest-return fallback when
--   same carrier unavailable (split_carrier = true).
--
-- Ancillary cost model:
--   Per leg: LEAST(à la carte, bundle) independently.
--   À la carte: cabin bag fee (when not included in base fare) + checked bag fee
--               + seat selection (when p_seats_together = true).
--   Bundle: bundle_price_delta_gbp × party_size when available.
--   When airline_baggage_fees row absent: ancillary assumed 0; has_*_baggage_data = false.
--
-- Fine:
--   calculate_absence_fine helper; uses caller's actual p_adults/p_children (not matched).
--
-- Composition matching (fare lookups only):
--   Input mapped to nearest of (1A+1C, 2A+1C, 2A+2C, 2A+1inf).
--
-- baggage_is_estimate, family_split_risk, split_risk_carriers:
--   Copied verbatim from get_allin_flight_cost.

CREATE OR REPLACE FUNCTION get_smart_recommendation(
  p_destination_slug text,
  p_school_urn       text,
  p_trip_type        text,      -- 'circuit' | 'city'
  p_adults           smallint,
  p_children         smallint,
  p_infants          smallint,
  p_cabin_bags       smallint,  -- full-size overhead cabin bags needed by party
  p_checked_bags     smallint,  -- checked bags needed by party
  p_seats_together   boolean
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_dest_id           uuid;
  v_dest_airports     text[];
  v_borough           text;
  v_run_id            uuid;
  v_adults            smallint;
  v_children          smallint;
  v_infants           smallint;
  v_party_size        int;
  v_data_min          date;
  v_data_max          date;
  v_window_start      date;
  v_window_end        date;
  v_window_source     text := 'school';
  v_dep_earliest      date;
  v_dep_latest        date;
  v_ret_earliest      date;
  v_ret_latest        date;
  v_min_nights        smallint;
  v_max_nights        smallint;
  v_baseline          numeric;
  v_result            jsonb;
BEGIN

  -- ── 1. Destination + airport pool ──────────────────────────────────────────

  SELECT id INTO v_dest_id
    FROM destinations WHERE slug = p_destination_slug;

  IF v_dest_id IS NULL THEN
    RETURN jsonb_build_object('error', 'destination not found: ' || p_destination_slug);
  END IF;

  SELECT array_agg(iata_code) INTO v_dest_airports
    FROM destination_airports
   WHERE destination_id = v_dest_id AND excluded = false;

  IF v_dest_airports IS NULL OR array_length(v_dest_airports, 1) = 0 THEN
    RETURN jsonb_build_object('error', 'no airport pool for: ' || p_destination_slug);
  END IF;

  -- ── 2. School metadata ──────────────────────────────────────────────────────

  SELECT borough INTO v_borough FROM all_schools WHERE urn = p_school_urn;

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

  SELECT id INTO v_run_id
    FROM snapshot_runs
   WHERE run_type    = 'cross_sectional'
     AND completed_at IS NOT NULL
   ORDER BY completed_at DESC
   LIMIT 1;

  IF v_run_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no completed cross-sectional run found');
  END IF;

  v_party_size := p_adults + p_children;

  -- ── 5. Anchor to fare data date range ───────────────────────────────────────

  SELECT MIN(departure_date), MAX(departure_date)
    INTO v_data_min, v_data_max
    FROM fare_snapshots
   WHERE run_id           = v_run_id
     AND destination_iata  = ANY(v_dest_airports)
     AND origin_iata       IN ('LHR','LGW','STN','LTN','LCY');

  IF v_data_min IS NULL THEN
    RETURN jsonb_build_object('error', 'no fare data for destination in latest run');
  END IF;

  -- ── 6. Official window — two-tier fallback (school → borough) ──────────────

  SELECT start_date, end_date
    INTO v_window_start, v_window_end
    FROM school_term_dates
   WHERE urn        = p_school_urn
     AND start_date BETWEEN v_data_min - 7 AND v_data_max + 7
   ORDER BY abs(start_date - (v_data_min + (v_data_max - v_data_min) / 2)) ASC
   LIMIT 1;

  IF v_window_start IS NULL THEN
    v_window_source := 'borough';
    IF v_borough IS NOT NULL THEN
      SELECT start_date, end_date
        INTO v_window_start, v_window_end
        FROM borough_term_dates
       WHERE borough    = v_borough
         AND start_date BETWEEN v_data_min - 7 AND v_data_max + 7
       ORDER BY abs(start_date - (v_data_min + (v_data_max - v_data_min) / 2)) ASC
       LIMIT 1;
    END IF;
  END IF;

  IF v_window_start IS NULL OR v_window_end IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'could not resolve term window for school: ' || p_school_urn
    );
  END IF;

  -- ── 7. Trip type date ranges ─────────────────────────────────────────────────

  IF p_trip_type = 'circuit' THEN
    v_dep_earliest := v_window_start - 4;
    v_dep_latest   := v_window_start;
    v_min_nights   := 7;
    v_max_nights   := 10;
  ELSE -- city
    v_dep_earliest := v_window_start - 4;
    v_dep_latest   := v_window_end;
    v_min_nights   := 3;
    v_max_nights   := 4;
  END IF;

  v_ret_earliest := v_dep_earliest + v_min_nights;
  v_ret_latest   := v_dep_latest + v_max_nights;

  -- ── 8. Baseline price ────────────────────────────────────────────────────────

  SELECT party_total_gbp INTO v_baseline
    FROM baseline_snapshots
   WHERE destination_slug = p_destination_slug
     AND adults           = v_adults
     AND children         = v_children
     AND infants          = v_infants
   LIMIT 1;

  -- ── 9. Best recommendation across all date × carrier combinations ────────────
  --
  -- out_fares:    min fare per (dep_date, carrier, London airport).
  -- best_out:     cheapest London airport per (dep_date, carrier) via DISTINCT ON.
  --               Mirrors get_allin_flight_cost best_out CTE verbatim.
  -- best_ret:     min fare per (ret_date, carrier).
  -- cheapest_ret: globally cheapest return carrier per ret_date (split fallback).
  -- carrier_pairs: for each (dep_date, carrier) × all valid ret_dates: same-carrier
  --               return preferred; cheapest_ret fallback. Mirrors get_allin_flight_cost
  --               carrier_pairs CTE, extended across all valid date pairs.
  -- with_costs:   baggage fees joined; à la carte ancillary breakdown per leg.
  --               baggage_is_estimate, family_split_risk, split_risk_carriers copied
  --               verbatim from get_allin_flight_cost with_costs CTE.
  -- with_ancillary: LEAST(à la carte, bundle) per leg independently.
  -- with_fine:    calculate_absence_fine LATERAL per row; net_saving = baseline
  --               − total_cost − fine. Mirrors get_compliance_scenarios calcs CTE.

  WITH
    -- ── Outbound fares ─────────────────────────────────────────────────────────
    out_fares AS (
      SELECT
        fs.departure_date,
        fs.airline_iata,
        fs.origin_iata,
        MIN(fs.party_total_gbp) AS fare
        FROM fare_snapshots fs
       WHERE fs.run_id           = v_run_id
         AND fs.origin_iata      IN ('LHR','LGW','STN','LTN','LCY')
         AND fs.destination_iata  = ANY(v_dest_airports)
         AND fs.departure_date   BETWEEN v_dep_earliest AND v_dep_latest
         AND fs.adults   = v_adults
         AND fs.children = v_children
         AND fs.infants  = v_infants
       GROUP BY fs.departure_date, fs.airline_iata, fs.origin_iata
    ),
    -- Best outbound per (departure_date, carrier): cheapest London airport wins.
    -- DISTINCT ON pattern mirrors get_allin_flight_cost best_out verbatim.
    best_out AS (
      SELECT DISTINCT ON (departure_date, airline_iata)
        departure_date,
        airline_iata,
        origin_iata AS best_airport,
        fare        AS out_fare
        FROM out_fares
       ORDER BY departure_date, airline_iata, fare ASC
    ),
    -- ── Return fares ───────────────────────────────────────────────────────────
    best_ret AS (
      SELECT
        fs.departure_date AS ret_date,
        fs.airline_iata,
        MIN(fs.party_total_gbp) AS ret_fare
        FROM fare_snapshots fs
       WHERE fs.run_id           = v_run_id
         AND fs.origin_iata       = ANY(v_dest_airports)
         AND fs.destination_iata  IN ('LHR','LGW','STN','LTN','LCY')
         AND fs.departure_date   BETWEEN v_ret_earliest AND v_ret_latest
         AND fs.adults   = v_adults
         AND fs.children = v_children
         AND fs.infants  = v_infants
       GROUP BY fs.departure_date, fs.airline_iata
    ),
    -- Globally cheapest return carrier per date (split-carrier fallback).
    cheapest_ret AS (
      SELECT DISTINCT ON (ret_date)
        ret_date,
        airline_iata,
        ret_fare
        FROM best_ret
       ORDER BY ret_date, ret_fare ASC
    ),
    -- ── Carrier pairs — mirrors get_allin_flight_cost carrier_pairs verbatim ───
    -- Joins cheapest_ret to enumerate all valid return dates per departure.
    -- Same carrier preferred; falls back to cheapest_ret when same carrier absent.
    carrier_pairs AS (
      SELECT
        bo.departure_date                                                AS dep_date,
        cr.ret_date,
        bo.airline_iata                                                  AS out_carrier,
        bo.best_airport,
        bo.out_fare,
        COALESCE(br.airline_iata, cr.airline_iata)                       AS ret_carrier,
        COALESCE(br.ret_fare,     cr.ret_fare)                           AS ret_fare,
        COALESCE(br.airline_iata, cr.airline_iata) <> bo.airline_iata   AS split_carrier
      FROM best_out bo
      JOIN cheapest_ret cr
        ON cr.ret_date > bo.departure_date
       AND (cr.ret_date - bo.departure_date) BETWEEN v_min_nights AND v_max_nights
      LEFT JOIN best_ret br
        ON br.ret_date     = cr.ret_date
       AND br.airline_iata = bo.airline_iata
      WHERE COALESCE(br.ret_fare, cr.ret_fare) IS NOT NULL
    ),
    -- ── Ancillary cost breakdown — mirrors get_allin_flight_cost with_costs ─────
    with_costs AS (
      SELECT
        cp.dep_date,
        cp.ret_date,
        cp.out_carrier,
        cp.best_airport,
        cp.out_fare,
        cp.ret_carrier,
        cp.ret_fare,
        cp.out_fare + cp.ret_fare                                        AS base_fare_total,
        cp.split_carrier,
        v_party_size                                                      AS party_size,
        -- Outbound: à la carte components
        CASE
          WHEN NOT COALESCE(abf_out.cabin_bag_included, TRUE) AND p_cabin_bags > 0
          THEN p_cabin_bags * COALESCE(abf_out.full_cabin_bag_fee_gbp, 0)
          ELSE 0
        END                                                               AS out_cabin_ala_carte,
        p_checked_bags * COALESCE(abf_out.first_checked_bag_gbp, 0)      AS out_checked_ala_carte,
        CASE WHEN p_seats_together
          THEN v_party_size * COALESCE(abf_out.seat_selection_gbp, 0)
          ELSE 0
        END                                                               AS out_seat_ala_carte,
        -- Return: à la carte components
        CASE
          WHEN NOT COALESCE(abf_ret.cabin_bag_included, TRUE) AND p_cabin_bags > 0
          THEN p_cabin_bags * COALESCE(abf_ret.full_cabin_bag_fee_gbp, 0)
          ELSE 0
        END                                                               AS ret_cabin_ala_carte,
        p_checked_bags * COALESCE(abf_ret.first_checked_bag_gbp, 0)      AS ret_checked_ala_carte,
        CASE WHEN p_seats_together
          THEN v_party_size * COALESCE(abf_ret.seat_selection_gbp, 0)
          ELSE 0
        END                                                               AS ret_seat_ala_carte,
        -- Bundle info per leg
        abf_out.bundle_name                                               AS out_bundle_name,
        abf_out.bundle_price_delta_gbp                                    AS out_bundle_delta,
        abf_out.bundle_includes_checked                                   AS out_bundle_inc_checked,
        abf_ret.bundle_name                                               AS ret_bundle_name,
        abf_ret.bundle_price_delta_gbp                                    AS ret_bundle_delta,
        abf_ret.bundle_includes_checked                                   AS ret_bundle_inc_checked,
        -- Cabin bag included flags (for UI)
        abf_out.cabin_bag_included                                        AS out_cabin_included,
        abf_ret.cabin_bag_included                                        AS ret_cabin_included,
        -- Baggage data availability flags
        abf_out.airline_iata IS NOT NULL                                  AS has_out_baggage_data,
        abf_ret.airline_iata IS NOT NULL                                  AS has_ret_baggage_data,
        -- baggage_is_estimate — copied verbatim from get_allin_flight_cost
        NOT (cp.out_carrier IN ('FR','U2','W6','VY','TP','BA')
         AND cp.ret_carrier IN ('FR','U2','W6','VY','TP','BA'))           AS baggage_is_estimate,
        -- family_split_risk — copied verbatim from get_allin_flight_cost
        ((cp.out_carrier IN ('FR','U2','W6')
          OR cp.ret_carrier IN ('FR','U2','W6'))
          AND v_party_size > 2)                                           AS family_split_risk,
        -- split_risk_carriers — copied verbatim from get_allin_flight_cost
        ARRAY_REMOVE(ARRAY[
          CASE WHEN cp.out_carrier IN ('FR','U2','W6') THEN cp.out_carrier END,
          CASE WHEN cp.ret_carrier IN ('FR','U2','W6')
                AND cp.ret_carrier <> cp.out_carrier
               THEN cp.ret_carrier END
        ], NULL)                                                          AS split_risk_carriers
      FROM carrier_pairs cp
      LEFT JOIN airline_baggage_fees abf_out ON abf_out.airline_iata = cp.out_carrier
      LEFT JOIN airline_baggage_fees abf_ret ON abf_ret.airline_iata = cp.ret_carrier
    ),
    -- ── Bundle optimisation: LEAST(à la carte total, bundle total) per leg ─────
    with_ancillary AS (
      SELECT
        wc.*,
        -- Outbound: use bundle when it beats à la carte total
        CASE
          WHEN wc.out_bundle_delta IS NOT NULL
          THEN LEAST(
            wc.out_cabin_ala_carte + wc.out_checked_ala_carte + wc.out_seat_ala_carte,
            wc.out_bundle_delta * wc.party_size
          )
          ELSE wc.out_cabin_ala_carte + wc.out_checked_ala_carte + wc.out_seat_ala_carte
        END                                                              AS out_ancillary,
        -- Return: use bundle when it beats à la carte total
        CASE
          WHEN wc.ret_bundle_delta IS NOT NULL
          THEN LEAST(
            wc.ret_cabin_ala_carte + wc.ret_checked_ala_carte + wc.ret_seat_ala_carte,
            wc.ret_bundle_delta * wc.party_size
          )
          ELSE wc.ret_cabin_ala_carte + wc.ret_checked_ala_carte + wc.ret_seat_ala_carte
        END                                                              AS ret_ancillary
      FROM with_costs wc
    ),
    -- ── Fine + net saving ─────────────────────────────────────────────────────
    -- Fine LATERAL mirrors get_compliance_scenarios calcs CTE pattern verbatim.
    -- Uses caller's actual p_adults/p_children (not matched composition).
    with_fine AS (
      SELECT
        wa.*,
        wa.out_ancillary + wa.ret_ancillary                              AS total_ancillary,
        wa.base_fare_total + wa.out_ancillary + wa.ret_ancillary         AS total_cost,
        fine_calc.departure_absence_days::smallint                       AS dep_absence,
        fine_calc.return_absence_days::smallint                          AS ret_absence,
        fine_calc.fine_gbp                                               AS fine_gbp,
        fine_calc.requires_absence                                       AS requires_absence,
        ROUND(v_baseline - (wa.base_fare_total + wa.out_ancillary + wa.ret_ancillary), 2)
                                                                         AS gross_saving,
        ROUND(
          v_baseline
          - (wa.base_fare_total + wa.out_ancillary + wa.ret_ancillary)
          - COALESCE(fine_calc.fine_gbp, 0),
          2
        )                                                                AS net_saving
      FROM with_ancillary wa
      LEFT JOIN LATERAL (
        SELECT *
          FROM jsonb_to_record(
            calculate_absence_fine(
              wa.dep_date,
              wa.ret_date,
              v_window_start,
              v_window_end,
              p_school_urn,
              p_adults,
              p_children
            )
          ) AS x(
            departure_absence_days smallint,
            return_absence_days    smallint,
            total_absence_days     smallint,
            fine_gbp               numeric,
            fine_is_estimate       boolean,
            requires_absence       boolean
          )
      ) fine_calc ON true
      WHERE v_baseline IS NOT NULL
    )
  SELECT jsonb_build_object(
    'window_start',                v_window_start,
    'window_end',                  v_window_end,
    'window_source',               v_window_source,
    'baseline_price',              v_baseline,
    'outbound_date',               f.dep_date,
    'return_date',                 f.ret_date,
    'trip_days',                   f.ret_date - f.dep_date,
    'outbound_carrier',            f.out_carrier,
    'return_carrier',              f.ret_carrier,
    'split_carrier',               f.split_carrier,
    'outbound_airport',            f.best_airport,
    'outbound_fare',               ROUND(f.out_fare,                              2),
    'return_fare',                 ROUND(f.ret_fare,                              2),
    'base_fare_total',             ROUND(f.base_fare_total,                       2),
    'party_size',                  f.party_size,
    'cabin_bags_requested',        p_cabin_bags,
    'checked_bags_requested',      p_checked_bags,
    'seats_together',              p_seats_together,
    'out_cabin_bag_included',      f.out_cabin_included,
    'ret_cabin_bag_included',      f.ret_cabin_included,
    'cabin_bag_cost_gbp',          ROUND((f.out_cabin_ala_carte
                                         + f.ret_cabin_ala_carte)::numeric,      2),
    'checked_bag_cost_gbp',        ROUND((f.out_checked_ala_carte
                                         + f.ret_checked_ala_carte)::numeric,    2),
    'seat_cost_gbp',               ROUND((f.out_seat_ala_carte
                                         + f.ret_seat_ala_carte)::numeric,       2),
    'out_ancillary_gbp',           ROUND(f.out_ancillary::numeric,               2),
    'ret_ancillary_gbp',           ROUND(f.ret_ancillary::numeric,               2),
    'total_ancillary_gbp',         ROUND(f.total_ancillary::numeric,             2),
    'total_cost_gbp',              ROUND(f.total_cost::numeric,                  2),
    'out_bundle_name',             f.out_bundle_name,
    'out_bundle_delta_gbp',        f.out_bundle_delta,
    'out_bundle_includes_checked', f.out_bundle_inc_checked,
    'ret_bundle_name',             f.ret_bundle_name,
    'ret_bundle_delta_gbp',        f.ret_bundle_delta,
    'ret_bundle_includes_checked', f.ret_bundle_inc_checked,
    'baggage_is_estimate',         f.baggage_is_estimate,
    'has_out_baggage_data',        f.has_out_baggage_data,
    'has_ret_baggage_data',        f.has_ret_baggage_data,
    'family_split_risk',           f.family_split_risk,
    'split_risk_carriers',         f.split_risk_carriers,
    'departure_absence_days',      f.dep_absence,
    'return_absence_days',         f.ret_absence,
    'fine_gbp',                    f.fine_gbp,
    'fine_is_estimate',            true,
    'requires_term_time_absence',  f.requires_absence,
    'gross_saving',                f.gross_saving,
    'net_saving',                  f.net_saving
  )
  INTO v_result
  FROM with_fine f
  ORDER BY f.net_saving DESC NULLS LAST
  LIMIT 1;

  IF v_result IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'no fare data available for destination: ' || p_destination_slug
    );
  END IF;

  RETURN v_result;

END;
$$;
