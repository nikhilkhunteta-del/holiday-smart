-- Widens snapshot_runs.valid_run_type to also allow 'weather_annual', so
-- the annual weather-history ingestion job can log its runs in the same
-- run-metadata table as the flights snapshot job (cross_sectional/tracer),
-- instead of a parallel table that would just re-derive the same columns.
--
-- NOTE: like destinations.sql, this is the first migration file
-- snapshot_runs has ever had in version control — the live table predates
-- this repo's supabase/tables/ convention. This file deliberately does NOT
-- attempt to reconstruct the full table — it only widens this one CHECK
-- constraint.
--
-- Additive only: 'cross_sectional' and 'tracer' remain valid, so existing
-- rows (which can only already contain one of those two values) are
-- unaffected — DROP + re-ADD by the same constraint name changes the rule
-- going forward, it does not touch any row's data. No column, default, or
-- other constraint on this table is changed.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS then ADD CONSTRAINT is safe to
-- re-run — this file is re-executed by .github/workflows/deploy-supabase.yml
-- on every push to main that touches supabase/tables/**.
ALTER TABLE snapshot_runs DROP CONSTRAINT IF EXISTS valid_run_type;

ALTER TABLE snapshot_runs
  ADD CONSTRAINT valid_run_type
  CHECK (run_type IN ('cross_sectional', 'tracer', 'weather_annual'));
