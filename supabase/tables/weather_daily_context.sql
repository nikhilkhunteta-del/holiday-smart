-- Layer 2 (raw): one row per destination x day, holding once-per-day
-- context (sunrise/sunset, sea temperature) that doesn't vary by hour and
-- would be wasteful/misleading to repeat on every weather_snapshots row.
-- Kept as its own table rather than columns on weather_snapshots for that
-- reason. Keyed on (destination_id, observed_date) only.
--
-- CORRECTED from an earlier version that additionally keyed this table
-- (and its primary key) on (window_start, window_end) — see
-- weather_snapshots.sql's header for the full reasoning: weather is
-- destination-specific, not borough-specific, so the raw layer must stay
-- borough-blind the same way fare_snapshots does. window_start/
-- window_end still belong on weather_window_stats/weather_strip_cells,
-- the derived per-window layer — untouched by this migration.
CREATE TABLE IF NOT EXISTS weather_daily_context (
  destination_id       uuid NOT NULL REFERENCES destinations(id),
  observed_date        date NOT NULL,
  sunrise_local        time NOT NULL,
  sunset_local         time NOT NULL,
  sea_surface_temp_c   numeric(4,1),

  PRIMARY KEY (destination_id, observed_date)
);

-- Migration for the already-live table (created under the old,
-- window-scoped schema before this correction). There is at most one
-- primary key per table, so no need to search by column composition to
-- find it — just check whether it already matches the new key. Fully
-- idempotent — on a fresh install (or once this has already run once)
-- the "already correct" check short-circuits and nothing below it runs,
-- so this is safe to leave in this file permanently (re-executed on
-- every push per deploy-supabase.yml).
DO $$
DECLARE
  already_correct boolean;
  old_pk          text;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
     WHERE rel.relname = 'weather_daily_context'
       AND con.contype = 'p'
       AND (
         SELECT array_agg(attname::text ORDER BY attname)
           FROM pg_attribute
          WHERE attrelid = rel.oid AND attnum = ANY(con.conkey)
       ) = ARRAY['destination_id', 'observed_date']
  ) INTO already_correct;

  IF NOT already_correct THEN
    SELECT con.conname INTO old_pk
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
     WHERE rel.relname = 'weather_daily_context'
       AND con.contype = 'p';

    IF old_pk IS NOT NULL THEN
      EXECUTE format('ALTER TABLE weather_daily_context DROP CONSTRAINT %I', old_pk);
    END IF;

    ALTER TABLE weather_daily_context DROP COLUMN IF EXISTS window_start;
    ALTER TABLE weather_daily_context DROP COLUMN IF EXISTS window_end;

    ALTER TABLE weather_daily_context ADD PRIMARY KEY (destination_id, observed_date);
  END IF;
END $$;
