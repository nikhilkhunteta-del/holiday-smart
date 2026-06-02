-- Function: get_smart_recommendation
-- Purpose:  Bottom-up engine for the Flight Insights page.
--           Returns ALL valid fare combinations across the full holiday window with
--           complete all-in costs (fare + ancillaries + transit), plus a baseline
--           object for comparison.
--
-- TypeScript contract:
--   Sort combinations by total_cost_gbp ASC. combinations[0] = recommendation.
--   Headline saving = baseline.total_cost_gbp - combinations[0].total_cost_gbp.
--   No "recommendation" key and no "net_saving" are computed here.
--
-- Ancillary model (per leg, independently):
--   à la carte = cabin bag cost + checked bag cost + seat cost
--   bundle      = party_size × bundle_price_delta_gbp
--   Bundle excluded when: delta IS NULL, or bundle_includes_checked = false AND
--     p_checked_bags > 0 (bundle doesn't cover checked bags).
--   Optimised = LEAST(à la carte, bundle) per leg.
--
-- Transit (4-rule, first match wins — mirrors transitCost.ts logic):
--   Rule 1: departure_time < 07:00 OR NULL  → uber XL-adjusted mean
--   Rule 2: transit fare NULL or no row      → uber XL-adjusted mean
--   Rule 3: transit_changes >= 2 AND
--           ABS(uber_xl_mean - transit_fare) <= £50  → uber XL-adjusted mean
--   Rule 4: default                           → transit_offpeak_fare / 100
--   XL adjustment: × 1.5 when total party (adults + children + infants) >= 4.
--
-- Carrier pairing (mirrors get_allin_flight_cost carrier_pairs verbatim):
--   Same-carrier return preferred; cheapest-return fallback (split_carrier = true).
--   Iterated across all valid date pairs in the window.
--
-- City vs circuit routing:
--   City:    outbound dest airport = return origin airport (symmetric).
--   Circuit: outbound dest and return origin may differ (open-jaw).

CREATE OR REPLACE FUNCTION get_smart_recommendation(
  p_destination_slug  text,
  p_school_urn        text,
  p_trip_type         text,        -- 'city' | 'circuit'
  p_adults            smallint,
  p_children          smallint,
  p_infants           smallint,
  p_cabin_bags        smallint,    -- total overhead cabin bags for party
  p_checked_bags      smallint,    -- total checked bags for party
  p_seats_together    boolean      -- true = include seat cost
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  -- Destination
  v_dest_id           uuid;
  v_dest_airports     text[];

  -- School
  v_postcode_district text;
  v_borough           text;

  -- Matched composition (fare lookups only)
  v_adults            smallint;
  v_children          smallint;
  v_infants           smallint;
  v_party_size        int;   -- p_adults + p_children (infants lap-carried; excluded from seat/bag costs)
  v_total_pax         int;   -- p_adults + p_children + p_infants (uber XL threshold)

  -- Run
  v_run_id            uuid;

  -- Date anchoring
  v_data_min          date;
  v_data_max          date;
  v_window_start      date;
  v_window_end        date;
  v_window_source     text    := 'school';
  v_dep_earliest      date;
  v_dep_latest        date;
  v_ret_earliest      date;
  v_ret_latest        date;
  v_min_nights        smallint;
  v_max_nights        smallint;

  -- Baseline
  v_baseline_sat      date;
  v_baseline_dep_date date;
  v_baseline_ret_date date;
  v_baseline_origin   text;
  v_baseline_carrier  text;
  v_baseline_fare     numeric;
  v_baseline_dep_time time    := '09:00'::time;
  v_baseline_fallback boolean := false;
  v_baseline_out      jsonb;

  -- Result
  v_combinations      jsonb;
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

  SELECT postcode_district, borough
    INTO v_postcode_district, v_borough
    FROM all_schools WHERE urn = p_school_urn;

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
  v_total_pax  := p_adults + p_children + p_infants;

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

  -- ── 7. Date ranges ───────────────────────────────────────────────────────────
  -- Mirrors get_compliance_scenarios exactly.
  -- Trip-length constraint (BETWEEN min AND max nights) enforced at join time.

  v_dep_earliest := v_window_start - 4;
  v_dep_latest   := v_window_end;
  v_ret_earliest := v_window_start;
  v_ret_latest   := v_window_end + 4;

  IF p_trip_type = 'circuit' THEN
    v_min_nights := 7;
    v_max_nights := 10;
  ELSE -- city
    v_min_nights := 3;
    v_max_nights := 4;
  END IF;

  -- ── 8. Combinations across all valid date × carrier pairs ────────────────────
  --
  -- out_fares:         all result_bucket='best' outbound rows with departure_time.
  -- best_out:          DISTINCT ON (dep_date, airline, dest_airport) — cheapest
  --                    London origin wins. dest_airport tracked for city constraint.
  -- ret_fares:         all result_bucket='best' return rows with arrival_time.
  -- best_ret:          DISTINCT ON (ret_date, airline, ret_orig) — cheapest per trio.
  -- cheapest_ret:      globally cheapest per (ret_date, ret_orig) — split fallback.
  -- carrier_pairs:     verbatim from get_allin_flight_cost, extended to all date pairs.
  --                    City: out_dest = ret_orig. Circuit: any pool airport per leg.
  -- with_transit:      LEFT JOIN district_airport_transit on school postcode × outbound airport.
  -- with_transit_cost: 4-rule recommendation logic.
  -- with_costs:        per-leg à la carte ancillary; baggage/risk flags verbatim from
  --                    get_allin_flight_cost with_costs CTE.
  -- with_ancillary:    LEAST(à la carte, bundle) per leg independently.
  -- with_fine:         calculate_absence_fine LATERAL + is_inset_day.

  WITH
    out_fares AS (
      SELECT
        fs.departure_date,
        fs.airline_iata,
        fs.origin_iata,
        fs.destination_iata,
        fs.party_total_gbp AS fare,
        fs.departure_time
      FROM fare_snapshots fs
      WHERE fs.run_id           = v_run_id
        AND fs.origin_iata      IN ('LHR','LGW','STN','LTN','LCY')
        AND fs.destination_iata  = ANY(v_dest_airports)
        AND fs.departure_date   BETWEEN v_dep_earliest AND v_dep_latest
        AND fs.adults           = v_adults
        AND fs.children         = v_children
        AND fs.infants          = v_infants
        AND fs.result_bucket    = 'best'
    ),
    -- Cheapest London origin per (departure_date, airline, destination_airport).
    -- DISTINCT ON mirrors get_allin_flight_cost best_out CTE verbatim.
    -- destination_iata retained so the city symmetric-routing constraint can be applied.
    best_out AS (
      SELECT DISTINCT ON (departure_date, airline_iata, destination_iata)
        departure_date              AS dep_date,
        airline_iata,
        origin_iata                 AS best_airport,
        destination_iata            AS out_dest_iata,
        fare                        AS out_fare,
        departure_time              AS out_dep_time
      FROM out_fares
      ORDER BY departure_date, airline_iata, destination_iata, fare ASC
    ),
    ret_fares AS (
      SELECT
        fs.departure_date           AS ret_date,
        fs.airline_iata,
        fs.origin_iata              AS ret_orig_iata,
        fs.party_total_gbp          AS fare,
        fs.arrival_time
      FROM fare_snapshots fs
      WHERE fs.run_id           = v_run_id
        AND fs.origin_iata       = ANY(v_dest_airports)
        AND fs.destination_iata  IN ('LHR','LGW','STN','LTN','LCY')
        AND fs.departure_date   BETWEEN v_ret_earliest AND v_ret_latest
        AND fs.adults           = v_adults
        AND fs.children         = v_children
        AND fs.infants          = v_infants
        AND fs.result_bucket    = 'best'
    ),
    -- Cheapest return per (ret_date, airline, ret_origin).
    best_ret AS (
      SELECT DISTINCT ON (ret_date, airline_iata, ret_orig_iata)
        ret_date,
        airline_iata,
        ret_orig_iata,
        fare                        AS ret_fare,
        arrival_time                AS ret_arr_time
      FROM ret_fares
      ORDER BY ret_date, airline_iata, ret_orig_iata, fare ASC
    ),
    -- Globally cheapest return per (ret_date, ret_origin): split-carrier fallback.
    cheapest_ret AS (
      SELECT DISTINCT ON (ret_date, ret_orig_iata)
        ret_date,
        ret_orig_iata,
        airline_iata,
        ret_fare,
        ret_arr_time
      FROM best_ret
      ORDER BY ret_date, ret_orig_iata, ret_fare ASC
    ),
    -- Carrier pairs — verbatim from get_allin_flight_cost carrier_pairs CTE,
    -- extended to iterate all valid (dep_date × ret_date) pairs in the window.
    -- Same carrier preferred; cheapest_ret fallback (split_carrier = true).
    -- City constraint: outbound destination = return origin (symmetric airport).
    carrier_pairs AS (
      SELECT
        bo.dep_date,
        cr.ret_date,
        bo.airline_iata                                                   AS out_carrier,
        bo.best_airport,
        bo.out_dest_iata,
        cr.ret_orig_iata,
        bo.out_fare,
        COALESCE(br.airline_iata,  cr.airline_iata)                       AS ret_carrier,
        COALESCE(br.ret_fare,      cr.ret_fare)                           AS ret_fare,
        COALESCE(br.ret_arr_time,  cr.ret_arr_time)                       AS ret_arr_time,
        bo.out_dep_time,
        COALESCE(br.airline_iata,  cr.airline_iata) <> bo.airline_iata   AS split_carrier
      FROM best_out bo
      JOIN cheapest_ret cr
        ON cr.ret_date > bo.dep_date
       AND (cr.ret_date - bo.dep_date) BETWEEN v_min_nights AND v_max_nights
       -- City: both legs must use the same European airport.
       -- Circuit: any pool airport per leg (open-jaw allowed).
       AND (p_trip_type = 'circuit' OR bo.out_dest_iata = cr.ret_orig_iata)
      LEFT JOIN best_ret br
        ON br.ret_date      = cr.ret_date
       AND br.ret_orig_iata  = cr.ret_orig_iata
       AND br.airline_iata   = bo.airline_iata
      WHERE COALESCE(br.ret_fare, cr.ret_fare) IS NOT NULL
    ),
    -- Transit data for outbound airport × school postcode district.
    -- uber_xl_gbp is NULL when uber_low_pence or uber_high_pence is absent.
    with_transit AS (
      SELECT
        cp.*,
        dat.transit_offpeak_fare_pence,
        dat.transit_changes,
        dat.uber_low_pence,
        dat.uber_high_pence,
        -- XL-adjusted uber mean (NULL when uber data absent)
        CASE
          WHEN dat.uber_low_pence IS NOT NULL AND dat.uber_high_pence IS NOT NULL
          THEN (dat.uber_low_pence + dat.uber_high_pence) / 2.0 / 100.0
               * CASE WHEN v_total_pax >= 4 THEN 1.5 ELSE 1.0 END
          ELSE NULL
        END                                                               AS uber_xl_gbp
      FROM carrier_pairs cp
      LEFT JOIN district_airport_transit dat
             ON dat.postcode_district = v_postcode_district
            AND dat.airport_code      = cp.best_airport
    ),
    -- 4-rule transit recommendation (first match wins).
    with_transit_cost AS (
      SELECT
        wt.*,
        CASE
          -- Rule 1: early departure (< 07:00) or NULL departure time
          WHEN wt.out_dep_time IS NULL
               OR EXTRACT(HOUR FROM wt.out_dep_time) < 7
            THEN wt.uber_xl_gbp
          -- Rule 2: transit fare absent or no transit row found
          WHEN wt.transit_offpeak_fare_pence IS NULL
            THEN wt.uber_xl_gbp
          -- Rule 3: ≥2 changes AND uber is within £50 of transit
          WHEN wt.transit_changes >= 2
               AND ABS(wt.uber_xl_gbp
                       - wt.transit_offpeak_fare_pence / 100.0) <= 50
            THEN wt.uber_xl_gbp
          -- Rule 4: default → public transit
          ELSE wt.transit_offpeak_fare_pence / 100.0
        END                                                               AS recommended_transit_cost,
        -- transit_is_uber: true when rules 1–3 apply
        CASE
          WHEN wt.out_dep_time IS NULL
               OR EXTRACT(HOUR FROM wt.out_dep_time) < 7
               OR wt.transit_offpeak_fare_pence IS NULL
               OR (wt.transit_changes >= 2
                   AND ABS(wt.uber_xl_gbp
                           - wt.transit_offpeak_fare_pence / 100.0) <= 50)
            THEN true
          ELSE false
        END                                                               AS transit_is_uber,
        -- transit_confidence: 'estimated' when no transit fare data (mirrors transitCost.ts)
        CASE
          WHEN wt.transit_offpeak_fare_pence IS NULL THEN 'estimated'
          ELSE 'ok'
        END                                                               AS transit_confidence
      FROM with_transit wt
    ),
    -- Per-leg à la carte ancillary breakdown.
    -- baggage_is_estimate, family_split_risk, split_risk_carriers copied verbatim
    -- from get_allin_flight_cost with_costs CTE.
    with_costs AS (
      SELECT
        wtc.*,
        -- Outbound cabin bag (0 when base fare includes cabin bag)
        CASE
          WHEN NOT COALESCE(abf_out.cabin_bag_included, true) AND p_cabin_bags > 0
          THEN p_cabin_bags * COALESCE(abf_out.full_cabin_bag_fee_gbp, 0)
          ELSE 0
        END                                                               AS out_cabin_cost,
        -- Return cabin bag
        CASE
          WHEN NOT COALESCE(abf_ret.cabin_bag_included, true) AND p_cabin_bags > 0
          THEN p_cabin_bags * COALESCE(abf_ret.full_cabin_bag_fee_gbp, 0)
          ELSE 0
        END                                                               AS ret_cabin_cost,
        -- Checked bags per leg
        p_checked_bags * COALESCE(abf_out.first_checked_bag_gbp, 0)      AS out_checked_cost,
        p_checked_bags * COALESCE(abf_ret.first_checked_bag_gbp, 0)      AS ret_checked_cost,
        -- Seat selection: per person per leg (verbatim from get_allin_flight_cost)
        CASE WHEN p_seats_together
          THEN v_party_size * COALESCE(abf_out.seat_selection_gbp, 0)
          ELSE 0
        END                                                               AS out_seat_cost,
        CASE WHEN p_seats_together
          THEN v_party_size * COALESCE(abf_ret.seat_selection_gbp, 0)
          ELSE 0
        END                                                               AS ret_seat_cost,
        -- Bundle fields per leg
        abf_out.bundle_price_delta_gbp                                    AS out_bundle_delta,
        abf_out.bundle_includes_checked                                   AS out_bundle_inc_checked,
        abf_ret.bundle_price_delta_gbp                                    AS ret_bundle_delta,
        abf_ret.bundle_includes_checked                                   AS ret_bundle_inc_checked,
        -- baggage_is_estimate — verbatim from get_allin_flight_cost
        NOT (wtc.out_carrier IN ('FR','U2','W6','VY','TP','BA')
         AND wtc.ret_carrier IN ('FR','U2','W6','VY','TP','BA'))          AS baggage_is_estimate,
        -- family_split_risk — verbatim from get_allin_flight_cost
        ((wtc.out_carrier IN ('FR','U2','W6')
          OR  wtc.ret_carrier IN ('FR','U2','W6'))
          AND v_party_size > 2)                                           AS family_split_risk,
        -- split_risk_carriers — verbatim from get_allin_flight_cost
        ARRAY_REMOVE(ARRAY[
          CASE WHEN wtc.out_carrier IN ('FR','U2','W6')
               THEN wtc.out_carrier END,
          CASE WHEN wtc.ret_carrier IN ('FR','U2','W6')
                AND wtc.ret_carrier <> wtc.out_carrier
               THEN wtc.ret_carrier END
        ], NULL)                                                          AS split_risk_carriers
      FROM with_transit_cost wtc
      LEFT JOIN airline_baggage_fees abf_out ON abf_out.airline_iata = wtc.out_carrier
      LEFT JOIN airline_baggage_fees abf_ret ON abf_ret.airline_iata = wtc.ret_carrier
    ),
    -- Bundle optimisation per leg independently.
    -- Bundle is excluded when: delta IS NULL, or bundle_includes_checked = false
    -- and p_checked_bags > 0 (bundle would not cover checked-bag cost).
    with_ancillary AS (
      SELECT
        wc.*,
        -- Outbound optimised ancillary
        CASE
          WHEN wc.out_bundle_delta IS NULL
            THEN wc.out_cabin_cost + wc.out_checked_cost + wc.out_seat_cost
          WHEN NOT COALESCE(wc.out_bundle_inc_checked, false)
               AND p_checked_bags > 0
            THEN wc.out_cabin_cost + wc.out_checked_cost + wc.out_seat_cost
          ELSE LEAST(
            wc.out_cabin_cost + wc.out_checked_cost + wc.out_seat_cost,
            v_party_size * wc.out_bundle_delta
          )
        END                                                               AS out_ancillary,
        -- Return optimised ancillary
        CASE
          WHEN wc.ret_bundle_delta IS NULL
            THEN wc.ret_cabin_cost + wc.ret_checked_cost + wc.ret_seat_cost
          WHEN NOT COALESCE(wc.ret_bundle_inc_checked, false)
               AND p_checked_bags > 0
            THEN wc.ret_cabin_cost + wc.ret_checked_cost + wc.ret_seat_cost
          ELSE LEAST(
            wc.ret_cabin_cost + wc.ret_checked_cost + wc.ret_seat_cost,
            v_party_size * wc.ret_bundle_delta
          )
        END                                                               AS ret_ancillary
      FROM with_costs wc
    ),
    -- Fine, absence, inset day, and totals.
    -- Fine uses caller's actual p_adults / p_children (not matched composition),
    -- matching the pattern in get_compliance_scenarios.
    with_fine AS (
      SELECT
        wa.*,
        wa.out_fare + wa.ret_fare
          + wa.out_ancillary + wa.ret_ancillary                           AS fare_plus_ancillary,
        (wa.out_cabin_cost + wa.ret_cabin_cost)                           AS cabin_bag_cost,
        (wa.out_checked_cost + wa.ret_checked_cost)                       AS checked_bag_cost,
        (wa.out_seat_cost + wa.ret_seat_cost)                             AS seat_cost_total,
        fine_calc.departure_absence_days
          + fine_calc.return_absence_days                                 AS absence_days,
        fine_calc.fine_gbp,
        fine_calc.requires_absence,
        EXISTS(
          SELECT 1 FROM school_inset_days
           WHERE urn  = p_school_urn
             AND date = wa.dep_date
        )                                                                 AS is_inset_day
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
    )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'outbound_date',            f.dep_date,
        'return_date',              f.ret_date,
        'origin_iata',              f.best_airport,
        'outbound_carrier',         f.out_carrier,
        'return_carrier',           f.ret_carrier,
        'split_carrier',            f.split_carrier,
        'outbound_fare_gbp',        ROUND(f.out_fare::numeric,                              2),
        'return_fare_gbp',          ROUND(f.ret_fare::numeric,                              2),
        'cabin_bag_cost_gbp',       ROUND(f.cabin_bag_cost::numeric,                        2),
        'checked_bag_cost_gbp',     ROUND(f.checked_bag_cost::numeric,                      2),
        'seat_cost_gbp',            ROUND(f.seat_cost_total::numeric,                       2),
        'fare_plus_ancillary_gbp',  ROUND(f.fare_plus_ancillary::numeric,                   2),
        'recommended_transit_cost', ROUND(f.recommended_transit_cost::numeric,              2),
        'total_cost_gbp',           ROUND(
                                      (f.fare_plus_ancillary
                                       + COALESCE(f.recommended_transit_cost, 0))::numeric, 2),
        'requires_absence',         f.requires_absence,
        'absence_days',             f.absence_days,
        'fine_gbp',                 f.fine_gbp,
        'outbound_departure_time',  to_char(f.out_dep_time, 'HH24:MI'),
        'return_arrival_time',      to_char(f.ret_arr_time, 'HH24:MI'),
        'is_inset_day',             f.is_inset_day,
        'baggage_is_estimate',      f.baggage_is_estimate,
        'family_split_risk',        f.family_split_risk,
        'split_risk_carriers',      f.split_risk_carriers,
        'transit_is_uber',          f.transit_is_uber,
        'transit_confidence',       f.transit_confidence
      )
      ORDER BY (f.fare_plus_ancillary + COALESCE(f.recommended_transit_cost, 0)) ASC NULLS LAST
    ),
    '[]'::jsonb
  )
  INTO v_combinations
  FROM with_fine f;

  -- ── 9. Baseline object ───────────────────────────────────────────────────────
  -- First Saturday on or after window_start (DOW: 0=Sun … 6=Sat).
  -- Prefer LHR; fall back to cheapest row for that Saturday across all airports;
  -- final fallback: any row for this destination (date-agnostic, LHR-first).

  v_baseline_sat := v_window_start
    + ((6 - EXTRACT(DOW FROM v_window_start)::int + 7) % 7);

  -- Attempt 1: LHR on the target Saturday
  SELECT
    bs.departure_date,
    bs.return_date,
    bs.origin_iata,
    bs.airline_iata,
    bs.party_total_gbp,
    COALESCE(
      CASE WHEN bs.raw_json #>> '{result,segments,0,departure}' LIKE '%T%'
           THEN split_part(bs.raw_json #>> '{result,segments,0,departure}', 'T', 2)::time
           ELSE NULL END,
      '09:00'::time
    )
  INTO
    v_baseline_dep_date, v_baseline_ret_date, v_baseline_origin,
    v_baseline_carrier,  v_baseline_fare,     v_baseline_dep_time
  FROM baseline_snapshots bs
  WHERE bs.destination_slug = p_destination_slug
    AND bs.departure_date   = v_baseline_sat
    AND bs.origin_iata      = 'LHR'
    AND bs.adults    = v_adults
    AND bs.children  = v_children
    AND bs.infants   = v_infants
  ORDER BY bs.party_total_gbp ASC
  LIMIT 1;

  -- Attempt 2: any airport on that Saturday (baseline_is_fallback = true)
  IF v_baseline_fare IS NULL THEN
    v_baseline_fallback := true;

    SELECT
      bs.departure_date,
      bs.return_date,
      bs.origin_iata,
      bs.airline_iata,
      bs.party_total_gbp,
      COALESCE(
        CASE WHEN bs.raw_json #>> '{result,segments,0,departure}' LIKE '%T%'
             THEN split_part(bs.raw_json #>> '{result,segments,0,departure}', 'T', 2)::time
             ELSE NULL END,
        '09:00'::time
      )
    INTO
      v_baseline_dep_date, v_baseline_ret_date, v_baseline_origin,
      v_baseline_carrier,  v_baseline_fare,     v_baseline_dep_time
    FROM baseline_snapshots bs
    WHERE bs.destination_slug = p_destination_slug
      AND bs.departure_date   = v_baseline_sat
      AND bs.adults    = v_adults
      AND bs.children  = v_children
      AND bs.infants   = v_infants
    ORDER BY bs.party_total_gbp ASC
    LIMIT 1;
  END IF;

  -- Attempt 3: date-agnostic fallback — LHR preferred, then cheapest
  IF v_baseline_fare IS NULL THEN
    v_baseline_fallback := true;

    SELECT
      bs.departure_date,
      bs.return_date,
      bs.origin_iata,
      bs.airline_iata,
      bs.party_total_gbp,
      COALESCE(
        CASE WHEN bs.raw_json #>> '{result,segments,0,departure}' LIKE '%T%'
             THEN split_part(bs.raw_json #>> '{result,segments,0,departure}', 'T', 2)::time
             ELSE NULL END,
        '09:00'::time
      )
    INTO
      v_baseline_dep_date, v_baseline_ret_date, v_baseline_origin,
      v_baseline_carrier,  v_baseline_fare,     v_baseline_dep_time
    FROM baseline_snapshots bs
    WHERE bs.destination_slug = p_destination_slug
      AND bs.adults    = v_adults
      AND bs.children  = v_children
      AND bs.infants   = v_infants
    ORDER BY (bs.origin_iata = 'LHR') DESC, bs.party_total_gbp ASC
    LIMIT 1;
  END IF;

  -- Compute baseline ancillary + transit using same logic as combinations.
  -- Baseline fare covers both legs (round-trip total), so ancillary applies × 2 legs.
  IF v_baseline_fare IS NOT NULL THEN
    WITH
      bl_abf AS (
        SELECT * FROM airline_baggage_fees WHERE airline_iata = v_baseline_carrier LIMIT 1
      ),
      bl_transit AS (
        SELECT
          dat.transit_offpeak_fare_pence,
          dat.transit_changes,
          dat.uber_low_pence,
          dat.uber_high_pence,
          CASE
            WHEN dat.uber_low_pence IS NOT NULL AND dat.uber_high_pence IS NOT NULL
            THEN (dat.uber_low_pence + dat.uber_high_pence) / 2.0 / 100.0
                 * CASE WHEN v_total_pax >= 4 THEN 1.5 ELSE 1.0 END
            ELSE NULL
          END AS uber_xl_gbp
        FROM district_airport_transit dat
        WHERE dat.postcode_district = v_postcode_district
          AND dat.airport_code      = 'LHR'
        LIMIT 1
      ),
      bl_calc AS (
        SELECT
          -- Cabin bags: 2 legs
          CASE
            WHEN NOT COALESCE(a.cabin_bag_included, true) AND p_cabin_bags > 0
            THEN 2 * p_cabin_bags * COALESCE(a.full_cabin_bag_fee_gbp, 0)
            ELSE 0
          END                                                             AS cabin_bag_cost,
          -- Checked bags: 2 legs
          2 * p_checked_bags * COALESCE(a.first_checked_bag_gbp, 0)      AS checked_bag_cost,
          -- Seat: 2 legs × party_size
          CASE WHEN p_seats_together
               THEN 2 * v_party_size * COALESCE(a.seat_selection_gbp, 0)
               ELSE 0
          END                                                             AS seat_cost,
          -- Bundle fields for 2-leg trip
          a.bundle_price_delta_gbp                                        AS bundle_delta,
          a.bundle_includes_checked                                       AS bundle_inc_checked,
          -- Transit: 4-rule logic, always LHR
          CASE
            WHEN v_baseline_dep_time IS NULL
                 OR EXTRACT(HOUR FROM v_baseline_dep_time) < 7
              THEN t.uber_xl_gbp
            WHEN t.transit_offpeak_fare_pence IS NULL
              THEN t.uber_xl_gbp
            WHEN t.transit_changes >= 2
                 AND ABS(t.uber_xl_gbp
                         - t.transit_offpeak_fare_pence / 100.0) <= 50
              THEN t.uber_xl_gbp
            ELSE t.transit_offpeak_fare_pence / 100.0
          END                                                             AS transit_cost
        FROM (SELECT 1 AS dummy) d
        LEFT JOIN bl_abf     a ON true
        LEFT JOIN bl_transit t ON true
      )
    SELECT
      jsonb_build_object(
        'outbound_date',            v_baseline_dep_date,
        'return_date',              v_baseline_ret_date,
        'origin_iata',              v_baseline_origin,
        'carrier',                  v_baseline_carrier,
        'baseline_fare_gbp',        ROUND(v_baseline_fare::numeric,                    2),
        'cabin_bag_cost_gbp',       ROUND(bc.cabin_bag_cost::numeric,                  2),
        'checked_bag_cost_gbp',     ROUND(bc.checked_bag_cost::numeric,                2),
        'seat_cost_gbp',            ROUND(bc.seat_cost::numeric,                       2),
        'fare_plus_ancillary_gbp',  ROUND(
          (v_baseline_fare
           + CASE
               WHEN bc.bundle_delta IS NULL
                 THEN bc.cabin_bag_cost + bc.checked_bag_cost + bc.seat_cost
               WHEN NOT COALESCE(bc.bundle_inc_checked, false) AND p_checked_bags > 0
                 THEN bc.cabin_bag_cost + bc.checked_bag_cost + bc.seat_cost
               ELSE LEAST(
                 bc.cabin_bag_cost + bc.checked_bag_cost + bc.seat_cost,
                 2 * v_party_size * bc.bundle_delta
               )
             END
          )::numeric, 2
        ),
        'recommended_transit_cost', ROUND(bc.transit_cost::numeric,                    2),
        'total_cost_gbp',           ROUND(
          (v_baseline_fare
           + CASE
               WHEN bc.bundle_delta IS NULL
                 THEN bc.cabin_bag_cost + bc.checked_bag_cost + bc.seat_cost
               WHEN NOT COALESCE(bc.bundle_inc_checked, false) AND p_checked_bags > 0
                 THEN bc.cabin_bag_cost + bc.checked_bag_cost + bc.seat_cost
               ELSE LEAST(
                 bc.cabin_bag_cost + bc.checked_bag_cost + bc.seat_cost,
                 2 * v_party_size * bc.bundle_delta
               )
             END
           + COALESCE(bc.transit_cost, 0)
          )::numeric, 2
        ),
        'baseline_is_fallback',     v_baseline_fallback
      )
    INTO v_baseline_out
    FROM bl_calc bc;
  END IF;

  -- ── Return ──────────────────────────────────────────────────────────────────

  RETURN jsonb_build_object(
    'combinations', COALESCE(v_combinations, '[]'::jsonb),
    'baseline',     v_baseline_out
  );

END;
$$;
