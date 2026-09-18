-- Layer 2 (raw): one row per destination x window x hourly observation,
-- fetched annually from Open-Meteo's historical archive. Keyed on the raw
-- (destination_id, window_start, window_end) triple, not a window label —
-- no canonical window-label concept exists anywhere in this codebase
-- (school_term_dates, borough_term_dates, and every RPC that takes
-- p_window_start/p_window_end all represent a window the same way), so
-- this table follows that same convention rather than inventing one.
--
-- observed_year is the calendar year of observed_date, stored separately
-- (not derived at query time) since a window can straddle a year boundary
-- and callers frequently need to group/filter by year directly (e.g. one
-- row per year for the headline/strip year-span cutoffs in
-- lib/weather/thresholds.ts).
--
-- raw_json retains Open-Meteo's full hourly response for that
-- destination/date/hour, so any field not promoted to its own column can
-- still be recovered without re-fetching.
CREATE TABLE IF NOT EXISTS weather_snapshots (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id          uuid NOT NULL REFERENCES destinations(id),
  window_start            date NOT NULL,
  window_end              date NOT NULL,
  observed_year           smallint NOT NULL,
  observed_date           date NOT NULL,
  observed_hour           smallint NOT NULL,
  precipitation_mm        numeric(6,2) NOT NULL,
  temperature_c           numeric(5,2),
  apparent_temperature_c  numeric(5,2),
  cloud_cover_pct         smallint,
  wind_speed_kmh          numeric(5,2),
  weather_code            smallint,
  is_daylight             boolean NOT NULL,
  raw_json                jsonb NOT NULL,
  fetched_at              timestamptz NOT NULL DEFAULT now(),

  UNIQUE (destination_id, window_start, window_end, observed_date, observed_hour)
);
