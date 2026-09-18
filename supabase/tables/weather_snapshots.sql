-- Layer 2 (raw): one row per destination x hourly observation, fetched
-- annually from Open-Meteo's historical archive. Keyed on
-- (destination_id, observed_date, observed_hour) only.
--
-- CORRECTED from an earlier version that additionally keyed this table on
-- (window_start, window_end): weather is destination-specific, not
-- borough-specific — only the WINDOW (which calendar days count as "the
-- holiday") varies by school/borough, via inset days. Keying the raw
-- observation table on window_start/window_end meant every borough's
-- slightly different window would trigger a separate, mostly-duplicate
-- fetch of the same underlying weather data — the same mistake this
-- project already avoided for fare_snapshots (raw/expensive data stays
-- borough-blind; only the derived layer varies by borough/window). The
-- job now fetches one wide calendar range per destination per year,
-- independent of any specific school's window — see
-- lib/weather/weatherSnapshotJob.ts. window_start/window_end still belong
-- on weather_window_stats/weather_strip_cells, the derived per-window
-- layer — untouched by this migration.
--
-- observed_year is the calendar year of observed_date, stored separately
-- (not derived at query time) since callers frequently need to group/
-- filter by year directly (e.g. one row per year for the headline/strip
-- year-span cutoffs in lib/weather/thresholds.ts).
--
-- raw_json retains Open-Meteo's full hourly response for that
-- destination/date/hour, so any field not promoted to its own column can
-- still be recovered without re-fetching.
CREATE TABLE IF NOT EXISTS weather_snapshots (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id          uuid NOT NULL REFERENCES destinations(id),
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

  UNIQUE (destination_id, observed_date, observed_hour)
);

-- Migration for the already-live table (created under the old,
-- window-scoped schema before this correction). Finds the old unique
-- constraint by column composition rather than by a guessed
-- auto-generated name (its exact name was never verified against the
-- live database), drops it and the two window columns, then adds the new
-- destination-only unique key. Fully idempotent — on a fresh install (or
-- once this has already run once) the "already correct" check short-
-- circuits and nothing below it runs, so this is safe to leave in this
-- file permanently (re-executed on every push per deploy-supabase.yml).
DO $$
DECLARE
  already_correct boolean;
  old_constraint  text;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
     WHERE rel.relname = 'weather_snapshots'
       AND con.contype = 'u'
       AND (
         SELECT array_agg(attname::text ORDER BY attname)
           FROM pg_attribute
          WHERE attrelid = rel.oid AND attnum = ANY(con.conkey)
       ) = ARRAY['destination_id', 'observed_date', 'observed_hour']
  ) INTO already_correct;

  IF NOT already_correct THEN
    SELECT con.conname INTO old_constraint
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
     WHERE rel.relname = 'weather_snapshots'
       AND con.contype = 'u'
       AND EXISTS (
         SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = rel.oid AND a.attnum = ANY(con.conkey) AND a.attname = 'window_start'
       );

    IF old_constraint IS NOT NULL THEN
      EXECUTE format('ALTER TABLE weather_snapshots DROP CONSTRAINT %I', old_constraint);
    END IF;

    ALTER TABLE weather_snapshots
      ADD CONSTRAINT weather_snapshots_dest_date_hour_key
      UNIQUE (destination_id, observed_date, observed_hour);
  END IF;
END $$;

ALTER TABLE weather_snapshots DROP COLUMN IF EXISTS window_start;
ALTER TABLE weather_snapshots DROP COLUMN IF EXISTS window_end;
