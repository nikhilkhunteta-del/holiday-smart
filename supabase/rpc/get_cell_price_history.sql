-- Per-cell airfare history for one exact (departure_date, return_date) pair,
-- read directly from the cell_price_history cache table — never a live
-- fare_snapshots scan. Powers the per-cell history chart below the date
-- matrix, which defaults to the current recommendation's date pair and
-- updates on matrix cell click. Same output shape as get_price_movement
-- (checks_total, checks_with_data, price_points: [{checked_on, total_gbp}])
-- so computePriceMovement() in lib/flights/priceMovement.ts works unchanged.
--
-- Run validity: filtered at read time via get_valid_history_run_ids(), not
-- baked into the cache table at write time — same reasoning as
-- get_destination_median_history.
CREATE OR REPLACE FUNCTION get_cell_price_history(
  p_destination_slug text,
  p_trip_type        text,
  p_adults           smallint,
  p_children         smallint,
  p_infants          smallint,
  p_departure_date   date,
  p_return_date      date
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
    SELECT cph.observed_at, cph.cheapest_airfare_gbp
    FROM cell_price_history cph
    WHERE cph.destination_slug = p_destination_slug
      AND cph.trip_type        = p_trip_type
      AND cph.adults           = p_adults
      AND cph.children         = p_children
      AND cph.infants          = p_infants
      AND cph.departure_date   = p_departure_date
      AND cph.return_date      = p_return_date
      AND cph.run_id IN (SELECT run_id FROM valid_runs)
  )

  SELECT jsonb_build_object(
    'checks_total',     (SELECT COUNT(*) FROM valid_runs),
    'checks_with_data', (SELECT COUNT(*) FROM matching),
    'price_points',      COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'checked_on', observed_at::date,
          'total_gbp',  cheapest_airfare_gbp
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
