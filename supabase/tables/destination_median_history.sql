-- Derived/cached data — one row per (valid run × destination × trip_type ×
-- composition), storing the median of that run's cheapest-per-cell airfares
-- across the whole candidate date-pair matrix. Powers the destination-level
-- "How {destination} prices have moved" card, below the date matrix.
--
-- Populated at snapshot-job time (end of each run) plus a one-off backfill
-- for existing valid runs — NEVER computed live from fare_snapshots on page
-- load. Scope is destination + trip_type + composition only, deliberately
-- not school/window-scoped (see route.ts / CLAUDE.md discussion) — this is
-- a destination-level statistic, and per-cell lookups only need a concrete
-- (departure_date, return_date), not window resolution.
--
-- "Valid run" here means whatever get_valid_history_run_ids() returns at
-- read time — this table stores the raw computed median for ANY run with
-- fare data, and the RPC that reads it (not yet written) is expected to
-- filter by get_valid_history_run_ids() itself, the same way
-- get_price_movement does — so a run's validity can be re-evaluated as new
-- runs land without needing to re-backfill old rows.
CREATE TABLE IF NOT EXISTS destination_median_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              uuid NOT NULL REFERENCES snapshot_runs(id),
  destination_slug    text NOT NULL,
  trip_type           text NOT NULL,     -- 'circuit' | 'city'
  adults              smallint NOT NULL,
  children            smallint NOT NULL,
  infants             smallint NOT NULL,
  observed_at         timestamptz NOT NULL, -- earliest observed_at among that run's contributing cells
  median_airfare_gbp  numeric NOT NULL,
  cell_count          integer NOT NULL,   -- how many date-pairs had complete (both-leg) data this run

  CONSTRAINT valid_trip_type CHECK (trip_type IN ('circuit', 'city')),
  UNIQUE (run_id, destination_slug, trip_type, adults, children, infants)
);

CREATE INDEX IF NOT EXISTS idx_dmh_lookup
  ON destination_median_history (destination_slug, trip_type, adults, children, infants, observed_at);
