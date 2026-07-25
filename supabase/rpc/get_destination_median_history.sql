-- Destination-level median airfare history, read directly from the
-- destination_median_history cache table — never a live fare_snapshots
-- scan. Powers the "How {destination} prices have moved" card below the
-- date matrix. Same output shape as get_price_movement (checks_total,
-- checks_with_data, price_points: [{checked_on, total_gbp}]) so
-- computePriceMovement() in lib/flights/priceMovement.ts works unchanged.
--
-- Run validity: filtered at read time via get_valid_history_run_ids(), not
-- baked into the cache table at write time — so a run's validity can be
-- re-evaluated as new runs land without needing to re-backfill old rows.
CREATE OR REPLACE FUNCTION get_destination_median_history(
  p_destination_slug text,
  p_trip_type        text,
  p_adults           smallint,
  p_children         smallint,
  p_infants          smallint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_result jsonb;
BEGIN

  WITH valid_runs AS (
    SELECT run_id FROM get_valid_history_run_ids()
  ),
  matching AS (
    SELECT dmh.observed_at, dmh.median_airfare_gbp
    FROM destination_median_history dmh
    WHERE dmh.destination_slug = p_destination_slug
      AND dmh.trip_type        = p_trip_type
      AND dmh.adults           = p_adults
      AND dmh.children         = p_children
      AND dmh.infants          = p_infants
      AND dmh.run_id IN (SELECT run_id FROM valid_runs)
  )

  SELECT jsonb_build_object(
    'checks_total',     (SELECT COUNT(*) FROM valid_runs),
    'checks_with_data', (SELECT COUNT(*) FROM matching),
    'price_points',      COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'checked_on', observed_at::date,
          'total_gbp',  median_airfare_gbp
        )
        ORDER BY observed_at ASC
      )
      FROM matching
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;

END;
$$;
