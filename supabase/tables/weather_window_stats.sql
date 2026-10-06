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

-- Nine columns relaxed to nullable so the strip/headline derivation
-- (lib/weather/backfillWindowDerivation.ts) can be the FIRST write for a
-- destination x window: it upserts a row computing only the washout/headline
-- fields, and these columns stay NULL until the separate derivation tasks
-- that own them (feels-like ranges, sea temp, daylight hours, rain-share,
-- severe-rain warnings) fill them in. NULL means "not computed yet" — never a
-- placeholder value. UI readers must tolerate NULL in these columns.
-- DROP NOT NULL is idempotent, so this stays safe to re-run.
ALTER TABLE weather_window_stats
  ALTER COLUMN pct_daylight_rain_after_2pm DROP NOT NULL,
  ALTER COLUMN hourly_rain_share           DROP NOT NULL,
  ALTER COLUMN daytime_feelslike_low_c     DROP NOT NULL,
  ALTER COLUMN daytime_feelslike_high_c    DROP NOT NULL,
  ALTER COLUMN evening_feelslike_low_c     DROP NOT NULL,
  ALTER COLUMN evening_feelslike_high_c    DROP NOT NULL,
  ALTER COLUMN sea_temp_c                  DROP NOT NULL,
  ALTER COLUMN daylight_hours_minutes      DROP NOT NULL,
  ALTER COLUMN severe_rain_warning_years   DROP NOT NULL;

-- Records what sea_temp_c is actually based on. sea_temp_c is a mean over the
-- headline years that HAVE sea data (the raw archive only has sea values for
-- recent years), so it can rest on far fewer years than headline_years_used.
-- sea_temp_years_used = how many headline years contributed; sea_temp_years =
-- those years as text, consecutive runs collapsed ("2023-2025", "2019, 2022-2024").
-- Both NULL when the destination has no sea data (sea_temp_c is NULL too).
ALTER TABLE weather_window_stats
  ADD COLUMN IF NOT EXISTS sea_temp_years_used smallint,
  ADD COLUMN IF NOT EXISTS sea_temp_years     text;

-- The effective severe-rain threshold in mm that severe_rain_warning_years was
-- counted against: the HIGHER of the destination's p95-of-wet-days value and the
-- fixed floor (WEATHER_THRESHOLDS.severeRainMinMm). Seasonal, not annual — the
-- percentile pool is only the ingested ~15 Oct-5 Nov days. NULL = not computed yet.
ALTER TABLE weather_window_stats
  ADD COLUMN IF NOT EXISTS severe_rain_threshold_mm numeric(5,2);

-- Which strip years severe_rain_warning_years counted, as text in the same style as
-- sea_temp_years: consecutive runs collapsed ("2019, 2024", "2016-2018"). Written by Task 4c
-- alongside the count. NULL = no year flagged, or not computed yet. The verdict uses the latest
-- year in it for "most recently YYYY", and omits that clause when this is NULL.
ALTER TABLE weather_window_stats
  ADD COLUMN IF NOT EXISTS severe_rain_years text;
