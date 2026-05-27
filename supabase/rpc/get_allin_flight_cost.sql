-- Function: get_allin_flight_cost
-- Purpose:  True all-in cost per outbound carrier: flight fare + checked baggage +
--           seat selection + school→airport transfer. Enables like-for-like
--           comparison across airlines that have very different headline vs true costs.
--
-- Row structure:
--   One row per unique outbound carrier that has fares for this destination/date.
--   Return leg: same carrier if available; falls back to cheapest return from any
--   carrier (flagged split_carrier = true).
--
-- Baggage cost:
--   first_checked_bag_gbp × party_size per leg, per carrier.
--   Null when either leg's airline is absent from airline_baggage_fees — the
--   caller should surface this as "baggage data unavailable" in the UI.
--   baggage_is_estimate = true always (curated table, not live API data).
--
-- Transfer cost:
--   school_airport_transit keyed by school postcode + outbound airport.
--   p_transport_mode = 'public' → cheapest_fare_pence / 100.
--   p_transport_mode = 'uber'   → midpoint of taxi_fare_low/high_pence / 100.
--   Both modes always returned for UI toggle; allin_total uses the requested mode.
--
-- school_airport_transit duration field notes (see seed_airline_baggage_fees.sql):
--   cheapest_duration_secs — stored in MINUTES despite the name; used as-is.
--   drive_duration_secs    — stored in SECONDS; divide by 60 for display.
--
-- party_size: adults + children only. Infants are lap-carried (no seat purchased).
-- Fine and term-date data are not needed here — those belong to Function 2.

CREATE OR REPLACE FUNCTION get_allin_flight_cost(
  p_destination_slug text,
  p_school_urn       text,
  p_outbound_date    date,
  p_return_date      date,
  p_adults           smallint,
  p_children         smallint,
  p_infants          smallint,
  p_transport_mode   text          -- 'public' | 'uber'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_dest_id       uuid;
  v_dest_airports text[];
  v_postcode      text;
  v_run_id        uuid;
  v_adults        smallint;
  v_children      smallint;
  v_infants       smallint;
  v_party_size    int;
  v_result        jsonb;
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

  -- ── 2. School postcode (transfer cost lookup) ───────────────────────────────

  SELECT postcode INTO v_postcode FROM all_schools WHERE urn = p_school_urn;

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

  -- Infants lap-carried: no seat purchased, not counted in baggage/seat costs
  v_party_size := p_adults + p_children;

  -- ── 5. Per-carrier cost matrix ──────────────────────────────────────────────

  WITH
    -- All outbound fares for this destination / date / composition
    out_fares AS (
      SELECT fs.airline_iata, fs.origin_iata, fs.party_total_gbp
        FROM fare_snapshots fs
       WHERE fs.run_id           = v_run_id
         AND fs.origin_iata      IN ('LHR','LGW','STN','LTN','LCY')
         AND fs.destination_iata  = ANY(v_dest_airports)
         AND fs.departure_date   = p_outbound_date
         AND fs.adults   = v_adults
         AND fs.children = v_children
         AND fs.infants  = v_infants
    ),
    -- Best outbound per airline: cheapest fare and the London airport that wins.
    -- Uses DISTINCT ON so the winning airport is always the cheapest-fare airport.
    best_out AS (
      SELECT DISTINCT ON (airline_iata)
        airline_iata,
        origin_iata AS best_airport,
        min_fare    AS out_fare
      FROM (
        SELECT airline_iata, origin_iata, MIN(party_total_gbp) AS min_fare
          FROM out_fares
         GROUP BY airline_iata, origin_iata
      ) per_ap
      ORDER BY airline_iata, min_fare ASC
    ),
    -- Best return fare per airline
    best_ret AS (
      SELECT fs.airline_iata, MIN(fs.party_total_gbp) AS ret_fare
        FROM fare_snapshots fs
       WHERE fs.run_id           = v_run_id
         AND fs.origin_iata       = ANY(v_dest_airports)
         AND fs.destination_iata  IN ('LHR','LGW','STN','LTN','LCY')
         AND fs.departure_date   = p_return_date
         AND fs.adults   = v_adults
         AND fs.children = v_children
         AND fs.infants  = v_infants
       GROUP BY fs.airline_iata
    ),
    -- For each outbound carrier: pair with its own return if available;
    -- fall back to the globally cheapest return carrier.
    -- split_carrier = true when no same-airline return exists.
    carrier_pairs AS (
      SELECT
        bo.airline_iata                             AS out_carrier,
        bo.best_airport,
        bo.out_fare,
        COALESCE(br.airline_iata, cr.airline_iata)  AS ret_carrier,
        COALESCE(br.ret_fare,     cr.ret_fare)       AS ret_fare,
        COALESCE(br.airline_iata, cr.airline_iata) <> bo.airline_iata AS split_carrier
      FROM best_out bo
      LEFT JOIN best_ret br ON br.airline_iata = bo.airline_iata
      LEFT JOIN LATERAL (
        SELECT airline_iata, ret_fare
          FROM best_ret
         ORDER BY ret_fare ASC
         LIMIT 1
      ) cr ON true
      WHERE COALESCE(br.ret_fare, cr.ret_fare) IS NOT NULL
    ),
    -- Join baggage fees for both carriers and school transit for the outbound airport
    with_costs AS (
      SELECT
        cp.out_carrier,
        cp.best_airport,
        cp.out_fare,
        cp.ret_carrier,
        cp.ret_fare,
        cp.out_fare + cp.ret_fare                  AS base_fare_total,
        cp.split_carrier,
        v_party_size                               AS party_size,
        -- Baggage: 1 checked bag × party_size, one per leg, one fee per carrier.
        -- Returns null if either airline is absent from airline_baggage_fees.
        CASE
          WHEN abf_out.airline_iata IS NOT NULL
           AND abf_ret.airline_iata IS NOT NULL
          THEN (abf_out.first_checked_bag_gbp + abf_ret.first_checked_bag_gbp)
               * v_party_size
          ELSE NULL
        END                                        AS baggage_cost,
        abf_out.first_checked_bag_gbp              AS out_bag_fee_pp,
        abf_ret.first_checked_bag_gbp              AS ret_bag_fee_pp,
        -- Seat selection: per person per leg
        CASE
          WHEN abf_out.airline_iata IS NOT NULL
           AND abf_ret.airline_iata IS NOT NULL
          THEN (COALESCE(abf_out.seat_selection_gbp, 0)
              + COALESCE(abf_ret.seat_selection_gbp, 0))
               * v_party_size
          ELSE NULL
        END                                        AS seat_cost,
        abf_out.seat_selection_gbp                 AS out_seat_fee_pp,
        abf_ret.seat_selection_gbp                 AS ret_seat_fee_pp,
        -- Bundle upgrade reference (outbound carrier only)
        abf_out.bundle_name                        AS bundle_name,
        abf_out.bundle_price_delta_gbp             AS bundle_price_delta_gbp,
        abf_out.bundle_includes_checked            AS bundle_includes_checked,
        -- Transfer: school postcode → outbound airport, both modes always returned
        -- cheapest_duration_secs is in MINUTES despite the name; used as-is for display
        CASE
          WHEN sat.cheapest_fare_pence IS NOT NULL
          THEN sat.cheapest_fare_pence / 100.0
          ELSE NULL
        END                                        AS public_transfer_gbp,
        sat.cheapest_legs_summary                  AS public_transfer_desc,
        sat.cheapest_duration_secs                 AS public_transfer_mins,
        -- drive_duration_secs is in SECONDS; divide by 60 for display
        ROUND((sat.drive_duration_secs / 60.0)::numeric, 0)
                                                   AS drive_duration_mins,
        CASE
          WHEN sat.taxi_fare_low_pence IS NOT NULL
           AND sat.taxi_fare_high_pence IS NOT NULL
          THEN (sat.taxi_fare_low_pence + sat.taxi_fare_high_pence) / 2.0 / 100.0
          ELSE NULL
        END                                        AS uber_transfer_gbp,
        sat.taxi_fare_low_pence  / 100.0           AS uber_low_gbp,
        sat.taxi_fare_high_pence / 100.0           AS uber_high_gbp,
        -- Family split risk: LCCs use algorithmic seating that may separate families
        ((cp.out_carrier IN ('FR','U2','W6')
          OR cp.ret_carrier IN ('FR','U2','W6'))
          AND v_party_size > 2)                    AS family_split_risk,
        -- Which specific carriers in this booking carry split risk
        ARRAY_REMOVE(ARRAY[
          CASE WHEN cp.out_carrier IN ('FR','U2','W6') THEN cp.out_carrier END,
          CASE WHEN cp.ret_carrier IN ('FR','U2','W6')
                AND cp.ret_carrier <> cp.out_carrier
               THEN cp.ret_carrier END
        ], NULL)                                   AS split_risk_carriers,
        abf_out.airline_iata IS NOT NULL           AS has_out_baggage_data,
        abf_ret.airline_iata IS NOT NULL           AS has_ret_baggage_data
      FROM carrier_pairs cp
      LEFT JOIN airline_baggage_fees abf_out ON abf_out.airline_iata = cp.out_carrier
      LEFT JOIN airline_baggage_fees abf_ret ON abf_ret.airline_iata = cp.ret_carrier
      LEFT JOIN school_airport_transit sat
             ON sat.school_postcode = v_postcode
            AND sat.airport_code    = cp.best_airport
    ),
    -- Compute all-in total using requested transport mode
    with_total AS (
      SELECT
        wc.*,
        wc.public_transfer_gbp IS NOT NULL                         AS transfer_cost_known,
        -- Transfer cost: null when transport cost is unknown for the active mode
        CASE p_transport_mode
          WHEN 'uber' THEN COALESCE(wc.uber_transfer_gbp, wc.public_transfer_gbp)
          ELSE             wc.public_transfer_gbp
        END                                                        AS transfer_cost,
        -- All-in total: null when transfer cost unknown; sorts last via NULLS LAST
        wc.base_fare_total
          + COALESCE(wc.baggage_cost, 0)
          + COALESCE(wc.seat_cost,    0)
          + CASE p_transport_mode
              WHEN 'uber' THEN COALESCE(wc.uber_transfer_gbp, wc.public_transfer_gbp)
              ELSE             wc.public_transfer_gbp
            END                                                    AS allin_total,
        (wc.has_out_baggage_data
         AND wc.has_ret_baggage_data
         AND wc.public_transfer_gbp IS NOT NULL)                   AS allin_is_complete
      FROM with_costs wc
    ),
    ranked AS (
      SELECT
        t.*,
        t.allin_total = MIN(t.allin_total) OVER () AS is_recommended
      FROM with_total t
    )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'outbound_carrier',        r.out_carrier,
        'return_carrier',          r.ret_carrier,
        'split_carrier',           r.split_carrier,
        'outbound_airport',        r.best_airport,
        'outbound_fare',           r.out_fare,
        'return_fare',             r.ret_fare,
        'base_fare_total',         r.base_fare_total,
        'party_size',              r.party_size,
        'baggage_cost',            r.baggage_cost,
        'outbound_bag_fee_pp',     r.out_bag_fee_pp,
        'return_bag_fee_pp',       r.ret_bag_fee_pp,
        'seat_cost',               r.seat_cost,
        'outbound_seat_fee_pp',    r.out_seat_fee_pp,
        'return_seat_fee_pp',      r.ret_seat_fee_pp,
        'bundle_name',             r.bundle_name,
        'bundle_price_delta_gbp',  r.bundle_price_delta_gbp,
        'bundle_includes_checked', r.bundle_includes_checked,
        'transfer_mode',           p_transport_mode,
        'transfer_cost_known',     r.transfer_cost_known,
        'transfer_cost',           r.transfer_cost,
        'public_transfer_gbp',     r.public_transfer_gbp,
        'public_transfer_desc',    r.public_transfer_desc,
        'public_transfer_mins',    r.public_transfer_mins,
        'uber_transfer_gbp',       r.uber_transfer_gbp,
        'uber_low_gbp',            r.uber_low_gbp,
        'uber_high_gbp',           r.uber_high_gbp,
        'drive_duration_mins',     r.drive_duration_mins,
        'allin_total',             ROUND(r.allin_total::numeric, 2),
        'allin_is_complete',       r.allin_is_complete,
        'baggage_is_estimate',     true,
        'family_split_risk',       r.family_split_risk,
        'split_risk_carriers',     r.split_risk_carriers,
        'is_recommended',          r.is_recommended
      )
      ORDER BY r.allin_total ASC NULLS LAST
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM ranked r;

  RETURN jsonb_build_object(
    'outbound_date',  p_outbound_date,
    'return_date',    p_return_date,
    'party_size',     v_party_size,
    'transport_mode', p_transport_mode,
    'carriers',       v_result
  );

END;
$$;
