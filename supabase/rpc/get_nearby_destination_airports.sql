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
--   Every non-primary airport in the pool that has outbound fare data.
--   Comparison is outbound-leg only — the parent can fly home from any airport
--   they choose, so return leg is excluded from the saving calculation.
--   For each secondary: outbound fare, fare saving vs primary outbound, destination-
--   side transfer cost (net saving adjustment), and above_threshold flag.
--
-- Transfer cost (net saving):
--   destination_airports.transfer_cost_gbp — curated estimate of airport→destination
--   ground transport cost (GBP). Null when not yet seeded.
--   net_saving = fare_saving − transfer_cost_gbp.
--   When transfer_cost_gbp IS NULL: net_saving = fare_saving, transfer_cost_excluded = true.
--
-- transfer_notes and drive_time_minutes are included in the return JSON for each
--   secondary airport (both columns exist on destination_airports).
--
-- above_threshold: net_saving ≥ £30 (consistent with all other saving levers).
-- comparison_basis: 'outbound_leg_only' — surfaced in JSON so the UI can label clearly.

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

  -- ── 5. Primary airport outbound fare ────────────────────────────────────────

  SELECT MIN(party_total_gbp)
    INTO v_primary_fare
    FROM fare_snapshots
   WHERE run_id           = v_run_id
     AND origin_iata      IN ('LHR','LGW','STN','LTN','LCY')
     AND destination_iata  = v_primary_iata
     AND departure_date   = p_outbound_date
     AND adults   = v_adults AND children = v_children AND infants = v_infants;

  IF v_primary_fare IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'no outbound fare data for primary airport: ' || v_primary_iata
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
    -- Outbound-only comparison: return leg excluded (parent can fly home from any airport)
    assembled AS (
      SELECT
        o.dest_ap      AS airport,
        o.out_fare     AS outbound_fare,
        NULL::numeric  AS return_fare,
        o.out_fare     AS total_fare
      FROM out_fares o
    ),
    -- Join destination-side transfer costs
    with_transfer AS (
      SELECT
        a.airport,
        a.outbound_fare,
        a.total_fare,
        v_primary_fare - a.total_fare                         AS fare_saving,
        da.transfer_cost_gbp,
        da.transfer_notes,
        da.drive_time_minutes,
        da.transfer_cost_gbp IS NULL                          AS transfer_cost_excluded,
        -- Net saving: subtract transfer cost when known; flag excluded when null
        CASE
          WHEN da.transfer_cost_gbp IS NOT NULL
          THEN v_primary_fare - a.total_fare - da.transfer_cost_gbp
          ELSE v_primary_fare - a.total_fare
        END                                                   AS net_saving
      FROM assembled a
      LEFT JOIN destination_airports da
             ON da.destination_id = v_dest_id
            AND da.iata_code      = a.airport
    )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'airport',                 t.airport,
        'outbound_fare',           ROUND(t.total_fare,   2),
        'fare_saving',             ROUND(t.fare_saving,  2),
        'transfer_cost_gbp',       t.transfer_cost_gbp,
        'transfer_notes',          t.transfer_notes,
        'drive_time_minutes',      t.drive_time_minutes,
        'transfer_cost_excluded',  t.transfer_cost_excluded,
        'net_saving',              ROUND(t.net_saving,   2),
        'above_threshold',         t.net_saving >= 30,
        'comparison_basis',        'outbound_leg_only'
      )
      ORDER BY t.net_saving DESC NULLS LAST
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM with_transfer t;

  RETURN jsonb_build_object(
    'primary_airport',        v_primary_iata,
    'primary_outbound_fare',  ROUND(v_primary_fare, 2),
    'comparison_basis',       'outbound_leg_only',
    'secondary_airports',     v_result
  );

END;
$$;
