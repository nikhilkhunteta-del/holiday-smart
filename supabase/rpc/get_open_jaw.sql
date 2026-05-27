-- Function: get_open_jaw
-- Purpose:  Open-jaw routing for circuit destinations only.
--           A circuit destination has ≥ 2 distinct airports in its pool
--           (e.g. Andalusian Corridor: fly into SVQ, fly out of AGP).
--           Returns NULL immediately when destination type ≠ 'circuit'.
--
-- Open-jaw pair: outbound London → airport A, return airport B → London, A ≠ B.
-- Symmetric:     same airport both ways — the naive booking a parent would make.
-- Saving:        symmetric_price − open_jaw_price (positive = open-jaw wins).
-- above_threshold: saving ≥ £30.
--
-- Transfer cost:
--   destination_airports.transfer_cost_gbp — destination-side ground transport
--   (airport → destination centre, curated estimate). Null when not yet seeded.
--   Note: spec referred to this as "transfer_notes"; the actual schema column is
--   transfer_cost_gbp (numeric). Returned for both winning airports so the UI
--   can surface net-of-transfer comparisons.
--
-- p_school_urn is accepted for interface consistency but is not used here;
-- open-jaw logic is destination-side, not school-to-London-airport.

CREATE OR REPLACE FUNCTION get_open_jaw(
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
  v_dest_id       uuid;
  v_dest_type     destination_type;
  v_dest_airports text[];
  v_run_id        uuid;
  v_adults        smallint;
  v_children      smallint;
  v_infants       smallint;

  v_oj_out_airport  text;
  v_oj_ret_airport  text;
  v_oj_out_fare     numeric;
  v_oj_ret_fare     numeric;
  v_oj_price        numeric;
  v_sym_price       numeric;
  v_saving          numeric;

  v_out_transfer    numeric;
  v_ret_transfer    numeric;
BEGIN

  -- ── 1. Destination type guard ────────────────────────────────────────────────

  SELECT id, type INTO v_dest_id, v_dest_type
    FROM destinations WHERE slug = p_destination_slug;

  IF v_dest_id IS NULL THEN
    RETURN jsonb_build_object('error', 'destination not found: ' || p_destination_slug);
  END IF;

  IF v_dest_type <> 'circuit' THEN
    RETURN NULL;
  END IF;

  -- ── 2. Destination airport pool ─────────────────────────────────────────────

  SELECT array_agg(iata_code) INTO v_dest_airports
    FROM destination_airports
   WHERE destination_id = v_dest_id AND excluded = false;

  IF v_dest_airports IS NULL OR array_length(v_dest_airports, 1) < 2 THEN
    RETURN jsonb_build_object(
      'error', 'circuit destination requires ≥ 2 non-excluded airports: ' || p_destination_slug
    );
  END IF;

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

  -- ── 5. Best open-jaw and best symmetric prices ───────────────────────────────
  --
  -- out_best: cheapest outbound fare from any London airport into each
  --           destination airport.
  -- ret_best: cheapest return fare from each destination airport to any
  --           London airport.
  -- open_jaw_best: lowest combined fare where out-airport ≠ ret-airport.
  -- sym_best:      lowest combined fare where out-airport = ret-airport
  --                (what a parent naively books).

  WITH
    out_best AS (
      SELECT
        fs.destination_iata               AS dest_ap,
        MIN(fs.party_total_gbp)           AS out_fare
        FROM fare_snapshots fs
       WHERE fs.run_id           = v_run_id
         AND fs.origin_iata      IN ('LHR','LGW','STN','LTN','LCY')
         AND fs.destination_iata  = ANY(v_dest_airports)
         AND fs.departure_date   = p_outbound_date
         AND fs.adults   = v_adults
         AND fs.children = v_children
         AND fs.infants  = v_infants
       GROUP BY fs.destination_iata
    ),
    ret_best AS (
      SELECT
        fs.origin_iata                    AS orig_ap,
        MIN(fs.party_total_gbp)           AS ret_fare
        FROM fare_snapshots fs
       WHERE fs.run_id           = v_run_id
         AND fs.origin_iata       = ANY(v_dest_airports)
         AND fs.destination_iata  IN ('LHR','LGW','STN','LTN','LCY')
         AND fs.departure_date   = p_return_date
         AND fs.adults   = v_adults
         AND fs.children = v_children
         AND fs.infants  = v_infants
       GROUP BY fs.origin_iata
    ),
    open_jaw_best AS (
      SELECT
        o.dest_ap                         AS out_ap,
        r.orig_ap                         AS ret_ap,
        o.out_fare,
        r.ret_fare,
        o.out_fare + r.ret_fare           AS combined
      FROM out_best o
      JOIN ret_best r ON r.orig_ap <> o.dest_ap
     ORDER BY combined ASC
     LIMIT 1
    ),
    sym_best AS (
      SELECT o.out_fare + r.ret_fare      AS combined
        FROM out_best o
        JOIN ret_best r ON r.orig_ap = o.dest_ap
       ORDER BY combined ASC
       LIMIT 1
    )
  SELECT
    oj.out_ap,
    oj.ret_ap,
    oj.out_fare,
    oj.ret_fare,
    oj.combined,
    s.combined
  INTO
    v_oj_out_airport,
    v_oj_ret_airport,
    v_oj_out_fare,
    v_oj_ret_fare,
    v_oj_price,
    v_sym_price
  FROM open_jaw_best oj
  LEFT JOIN LATERAL (SELECT combined FROM sym_best LIMIT 1) s ON true;

  IF v_oj_price IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'no open-jaw fare data available for destination: ' || p_destination_slug
    );
  END IF;

  v_saving := COALESCE(v_sym_price, v_oj_price) - v_oj_price;

  -- ── 6. Destination-side transfer costs for winning airports ─────────────────

  SELECT transfer_cost_gbp INTO v_out_transfer
    FROM destination_airports
   WHERE destination_id = v_dest_id AND iata_code = v_oj_out_airport;

  SELECT transfer_cost_gbp INTO v_ret_transfer
    FROM destination_airports
   WHERE destination_id = v_dest_id AND iata_code = v_oj_ret_airport;

  -- ── 7. Result ────────────────────────────────────────────────────────────────

  RETURN jsonb_build_object(
    'destination_type',             'circuit',
    'outbound_airport',             v_oj_out_airport,
    'return_airport',               v_oj_ret_airport,
    'outbound_fare',                ROUND(v_oj_out_fare,  2),
    'return_fare',                  ROUND(v_oj_ret_fare,  2),
    'open_jaw_price',               ROUND(v_oj_price,     2),
    'symmetric_price',              ROUND(v_sym_price,    2),
    'saving',                       ROUND(v_saving,       2),
    'above_threshold',              v_saving >= 30,
    'recommended',                  CASE WHEN v_saving > 0 THEN 'open_jaw' ELSE 'symmetric' END,
    'outbound_airport_transfer_cost_gbp', v_out_transfer,
    'return_airport_transfer_cost_gbp',   v_ret_transfer
  );

END;
$$;
