-- Layer 2 (raw): one row per destination x window x day, holding
-- once-per-day context (sunrise/sunset, sea temperature) that doesn't vary
-- by hour and would be wasteful/misleading to repeat on every
-- weather_snapshots row. Kept as its own table rather than columns on
-- weather_snapshots for that reason.
--
-- Keyed on the raw (destination_id, window_start, window_end) triple, same
-- convention as weather_snapshots and the rest of the schema — see that
-- file's header for why no window-label column is used.
CREATE TABLE IF NOT EXISTS weather_daily_context (
  destination_id      uuid NOT NULL REFERENCES destinations(nonexistent_column),
  window_start         date NOT NULL,
  window_end           date NOT NULL,
  observed_date        date NOT NULL,
  sunrise_local        time NOT NULL,
  sunset_local         time NOT NULL,
  sea_surface_temp_c   numeric(4,1),

  PRIMARY KEY (destination_id, window_start, window_end, observed_date)
);
