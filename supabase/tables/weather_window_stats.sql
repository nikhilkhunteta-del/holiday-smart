-- Layer 3 (derived): one row per destination x window, holding the
-- computed figures the UI actually reads (verdict headline, feels-like
-- ranges, sea temp, washout odds, etc.) — populated from weather_snapshots
-- + weather_daily_context by derivation code, never computed live on page
-- load. Same pattern as destination_median_history/cell_price_history:
-- raw observation tables feed a precomputed stats table.
--
-- Keyed on the raw (destination_id, window_start, window_end) pair, same
-- convention as the rest of this schema — see weather_snapshots.sql for
-- why no window-label column is used.
--
-- headline_years_used / headline_clean_year_count / headline_total_years
-- and strip_years_used correspond to WEATHER_THRESHOLDS.headlineYearSpan
-- and .stripYearSpan (lib/weather/thresholds.ts) — stored per-row rather
-- than re-read from that config at query time, since the config could
-- change after a row was computed and the row should reflect what was
-- actually used to compute it.
CREATE TABLE IF NOT EXISTS weather_window_stats (
  destination_id                uuid NOT NULL REFERENCES destinations(id),
  window_start                   date NOT NULL,
  window_end                     date NOT NULL,
  computed_at                    timestamptz NOT NULL DEFAULT now(),
  headline_years_used            smallint NOT NULL,
  headline_clean_year_count      smallint NOT NULL,
  headline_total_years           smallint NOT NULL,
  strip_years_used               smallint NOT NULL,
  typical_washout_days           numeric(3,1) NOT NULL,
  washout_days_min               smallint NOT NULL,
  washout_days_max               smallint NOT NULL,
  consecutive_washout_years      smallint NOT NULL,
  pct_daylight_rain_after_2pm    numeric(4,1) NOT NULL,
  hourly_rain_share              jsonb NOT NULL,
  daytime_feelslike_low_c        numeric(4,1) NOT NULL,
  daytime_feelslike_high_c       numeric(4,1) NOT NULL,
  evening_feelslike_low_c        numeric(4,1) NOT NULL,
  evening_feelslike_high_c       numeric(4,1) NOT NULL,
  sea_temp_c                     numeric(4,1) NOT NULL,
  daylight_hours_minutes         text NOT NULL,
  sunset_shift_note              text,
  severe_rain_warning_years      smallint NOT NULL,

  PRIMARY KEY (destination_id, window_start, window_end)
);
