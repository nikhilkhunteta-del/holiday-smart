-- Function: get_nearby_destination_airports
-- Purpose:  Secondary destination airports cheaper to fly into than the primary.
--           Returns NULL when only one airport exists in the pool (section won't render).
--
-- Primary airport:
--   The airport with the most outbound fare_snapshot rows for this destination /
--   composition / date in the latest run — a proxy for "most London service" /
--   most established airport that a parent would naively book.
--
-- Secondary airports:
--   Every non-primary airport in the pool that has both outbound and return fare data.
--   For each secondary: assembled round-trip fare, fare saving vs primary, destination-
--   side transfer cost (net saving adjustment), and above_threshold flag.
--
-- Transfer cost (net saving):
--   destination_airports.transfer_cost_gbp — curated estimate of airport→destination
--   ground transport cost (GBP). Null when not yet seeded.
--   net_saving = fare_saving − transfer_cost_gbp.
--   When transfer_cost_gbp IS NULL: net_saving = fare_saving, transfer_cost_excluded = true.
--
-- Schema note: spec referenced transfer_notes and drive_time_minutes columns on
--   destination_airports. Only transfer_cost_gbp exists in the current schema.
--   data-model.md §4 describes drive time as planned but not yet implemented.
--   These fields are absent from the return JSON until the schema is extended.
--
-- above_threshold: net_saving ≥ £30 (consistent with all other saving levers).

CREATE OR REPLACE FUNCTION get_nearby_destination_airports(
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
  v_dest_airports text[];
  v_run_id        uuid;
  v_adults        smallint;
  v_children      smallint;
  v_infants       smallint;

  v_primary_iata  text;
  v_primary_fare  numeric;
  v_result        jsonb;
BEGIN

  -- ── 1. Destination + airport pool ──────────────────────────────────────────

  SELECT id INTO v_dest_id FROM destinations WHERE slug = p_destination_slug;

  IF v_dest_id IS NULL THEN
    RETURN jsonb_build_object('error', 'destination not found: ' || p_destination_slug);
  END IF;

  SELECT array_agg(iata_code) INTO v_dest_airports
    FROM destination_airports
   WHERE destination_id = v_dest_id AND excluded = false;

  IF v_dest_airports IS NULL OR array_length(v_dest_airports, 1) = 0 THEN
    RETURN jsonb_build_object('error', 'no airport pool for: ' || p_destination_slug);
  END IF;

  -- Only meaningful when multiple airports exist
  IF array_length(v_dest_airports, 1) < 2 THEN
    RETURN NULL;
  END IF;

  -- ── 2. Composition matching ─────────────────────────────────────────────────

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

  -- ── 3. Latest completed cross-sectional run ─────────────────────────────────

  SELECT id INTO v_run_id
    FROM snapshot_runs
   WHERE run_type    = 'cross_sectional'
     AND completed_at IS NOT NULL
   ORDER BY completed_at DESC
   LIMIT 1;

  IF v_run_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no completed cross-sectional run found');
  END IF;

  -- ── 4. Primary airport: most outbound rows for this destination / date / run ─
  -- Row count is the proxy for "most established airport with London service".
  -- Uses outbound leg only (London → destination) for counting.

  SELECT fs.destination_iata INTO v_primary_iata
    FROM fare_snapshots fs
   WHERE fs.run_id           = v_run_id
     AND fs.destination_iata  = ANY(v_dest_airports)
     AND fs.departure_date   = p_outbound_date
     AND fs.adults   = v_adults
     AND fs.children = v_children
     AND fs.infants  = v_infants
   GROUP BY fs.destination_iata
   ORDER BY COUNT(*) DESC
   LIMIT 1;

  IF v_primary_iata IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'no outbound fare data for destination on requested date: ' || p_destination_slug
    );
  END IF;

  -- ── 5. Primary airport assembled fare (outbound + return) ───────────────────

  SELECT
    (SELECT MIN(party_total_gbp)
       FROM fare_snapshots
      WHERE run_id           = v_run_id
        AND origin_iata      IN ('LHR','LGW','STN','LTN','LCY')
        AND destination_iata  = v_primary_iata
        AND departure_date   = p_outbound_date
        AND adults   = v_adults AND children = v_children AND infants = v_infants)
    +
    (SELECT MIN(party_total_gbp)
       FROM fare_snapshots
      WHERE run_id           = v_run_id
        AND origin_iata       = v_primary_iata
        AND destination_iata  IN ('LHR','LGW','STN','LTN','LCY')
        AND departure_date   = p_return_date
        AND adults   = v_adults AND children = v_children AND infants = v_infants)
  INTO v_primary_fare;

  IF v_primary_fare IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'incomplete fare data for primary airport: ' || v_primary_iata
    );
  END IF;

  -- ── 6. Secondary airports: fare savings and net saving ──────────────────────

  WITH
    -- Best outbound fare per destination airport (London → dest airport)
    out_fares AS (
      SELECT
        fs.destination_iata               AS dest_ap,
        MIN(fs.party_total_gbp)           AS out_fare
        FROM fare_snapshots fs
       WHERE fs.run_id           = v_run_id
         AND fs.origin_iata      IN ('LHR','LGW','STN','LTN','LCY')
         AND fs.destination_iata  = ANY(v_dest_airports)
         AND fs.destination_iata  <> v_primary_iata
         AND fs.departure_date   = p_outbound_date
         AND fs.adults   = v_adults
         AND fs.children = v_children
         AND fs.infants  = v_infants
       GROUP BY fs.destination_iata
    ),
    -- Best return fare per destination airport (dest airport → London)
    ret_fares AS (
      SELECT
        fs.origin_iata                    AS orig_ap,
        MIN(fs.party_total_gbp)           AS ret_fare
        FROM fare_snapshots fs
       WHERE fs.run_id           = v_run_id
         AND fs.origin_iata       = ANY(v_dest_airports)
         AND fs.origin_iata       <> v_primary_iata
         AND fs.destination_iata  IN ('LHR','LGW','STN','LTN','LCY')
         AND fs.departure_date   = p_return_date
         AND fs.adults   = v_adults
         AND fs.children = v_children
         AND fs.infants  = v_infants
       GROUP BY fs.origin_iata
    ),
    -- Assembled round-trip: only airports with both directions
    assembled AS (
      SELECT
        o.dest_ap                         AS airport,
        o.out_fare,
        r.ret_fare,
        o.out_fare + r.ret_fare           AS total_fare
      FROM out_fares o
      JOIN ret_fares r ON r.orig_ap = o.dest_ap
    ),
    -- Join destination-side transfer costs
    with_transfer AS (
      SELECT
        a.airport,
        a.out_fare,
        a.ret_fare,
        a.total_fare,
        v_primary_fare - a.total_fare                         AS fare_saving,
        da.transfer_cost_gbp,
        da.transfer_cost_gbp IS NULL                          AS transfer_cost_excluded,
        -- Net saving: subtract transfer cost when available, else fare saving as-is
        v_primary_fare - a.total_fare
          - COALESCE(da.transfer_cost_gbp, 0)                 AS net_saving
      FROM assembled a
      LEFT JOIN destination_airports da
             ON da.destination_id = v_dest_id
            AND da.iata_code      = a.airport
    )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'airport',                 t.airport,
        'outbound_fare',           ROUND(t.out_fare,     2),
        'return_fare',             ROUND(t.ret_fare,     2),
        'total_fare',              ROUND(t.total_fare,   2),
        'fare_saving',             ROUND(t.fare_saving,  2),
        'transfer_cost_gbp',       t.transfer_cost_gbp,
        'transfer_cost_excluded',  t.transfer_cost_excluded,
        'net_saving',              ROUND(t.net_saving,   2),
        'above_threshold',         t.net_saving >= 30
      )
      ORDER BY t.net_saving DESC NULLS LAST
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM with_transfer t;

  RETURN jsonb_build_object(
    'primary_airport',    v_primary_iata,
    'primary_total_fare', ROUND(v_primary_fare, 2),
    'secondary_airports', v_result
  );

END;
$$;
