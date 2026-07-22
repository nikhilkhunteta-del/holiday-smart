-- Shared run-validity heuristic, extracted so every consumer of "which runs
-- count as real history" (get_price_movement, the destination/cell price
-- history backfill + population, and anything future) calls the same
-- function instead of re-implementing the CTE chain.
--
-- Heuristic (deliberately NOT a hardcoded run_id list, so this keeps working
-- unchanged as more runs accumulate):
--   run_type = 'cross_sectional' AND completed_at IS NOT NULL AND success_calls > 0,
--   further excluding any run whose success_calls is less than 10% of the
--   largest success_calls among those candidates (guards against small
--   test/debug/crashed runs without needing manual curation).
-- observed_at is deliberately NOT used here — run validity is decided from
-- snapshot_runs metadata only; observed_at (per fare_snapshots row) is a
-- separate concern used only to label individual price points later.
CREATE OR REPLACE FUNCTION get_valid_history_run_ids()
RETURNS TABLE(run_id uuid, completed_at timestamptz)
LANGUAGE sql
STABLE
AS $$
  WITH candidate_runs AS (
    SELECT id, completed_at, success_calls
    FROM snapshot_runs
    WHERE run_type = 'cross_sectional'
      AND completed_at IS NOT NULL
      AND success_calls > 0
  ),
  threshold AS (
    SELECT COALESCE(MAX(success_calls), 0) * 0.10 AS min_calls
    FROM candidate_runs
  )
  SELECT cr.id AS run_id, cr.completed_at
  FROM candidate_runs cr, threshold t
  WHERE cr.success_calls >= t.min_calls;
$$;
