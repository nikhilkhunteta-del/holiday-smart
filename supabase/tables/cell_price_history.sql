-- Derived/cached data — one row per (valid run × destination × trip_type ×
-- composition × date-pair), storing that run's cheapest airfare for one
-- exact (departure_date, return_date) combination. Powers the per-cell
-- price history chart below the date matrix, which defaults to the current
-- recommendation's date pair and updates when a matrix cell is clicked.
--
-- Populated at snapshot-job time (end of each run) plus a one-off backfill
-- for existing valid runs — NEVER computed live from fare_snapshots on page
-- load. cheapest_airfare_gbp is MIN(party_total_gbp) per leg across the
-- WHOLE destination airport pool (all abroad pool airports x all London
-- airports), inner-joined so a date-pair without both legs' data doesn't
-- count — deliberately NOT the matrix UI's own array-order-dependent cell
-- selection (see cellMap in compliance-calculator.tsx), which isn't
-- guaranteed-cheapest and isn't a well-defined thing to snapshot historically.
--
-- Same "valid run" note as destination_median_history: this table stores
-- the raw computed value for ANY run with fare data; validity filtering
-- happens at read time via get_valid_history_run_ids(), not baked in here.
CREATE TABLE IF NOT EXISTS cell_price_history (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                uuid NOT NULL REFERENCES snapshot_runs(id),
  destination_slug      text NOT NULL,
  trip_type             text NOT NULL,     -- 'circuit' | 'city'
  adults                smallint NOT NULL,
  children              smallint NOT NULL,
  infants               smallint NOT NULL,
  departure_date        date NOT NULL,
  return_date           date NOT NULL,
  observed_at           timestamptz NOT NULL, -- earliest observed_at between this cell's two legs
  cheapest_airfare_gbp  numeric NOT NULL,

  CONSTRAINT valid_trip_type CHECK (trip_type IN ('circuit', 'city')),
  UNIQUE (run_id, destination_slug, trip_type, adults, children, infants, departure_date, return_date)
);

CREATE INDEX IF NOT EXISTS idx_cph_lookup
  ON cell_price_history (destination_slug, trip_type, adults, children, infants, departure_date, return_date, observed_at);
