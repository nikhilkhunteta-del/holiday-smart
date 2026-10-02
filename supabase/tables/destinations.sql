-- destinations.iana_timezone — destination-local IANA timezone identifier
-- (e.g. 'Europe/Madrid' for Barcelona), used to bucket daylight hours and
-- detect DST-change dates per destination for the weather feature. Lives on
-- `destinations`, not `airports`/`destination_airports` — a circuit's two
-- airports (e.g. Andalusian Corridor: SVQ + AGP) still share one
-- destination-local time zone for this purpose.
--
-- NOTE: this is the first migration file `destinations` has ever had in
-- version control — the live table predates this repo's supabase/tables/
-- convention and was created directly against Supabase, so there is no
-- CREATE TABLE for it here to extend. This file deliberately does NOT
-- attempt to reconstruct the full table (data-model.md's design doc is
-- already known to have drifted from live schema at least once —
-- destination_legs vs destination_airports) — it only adds this one
-- column, idempotently, matching the ALTER-only scope requested.
--
-- Added nullable here, not NOT NULL: this file is re-executed by
-- .github/workflows/deploy-supabase.yml on every push to main that touches
-- supabase/tables/**, so it must stay safe to run before any backfill has
-- happened. NOT NULL is enforced separately, once existing rows are
-- backfilled — see supabase/backfill/backfill_destination_timezones.sql.
ALTER TABLE destinations
  ADD COLUMN IF NOT EXISTS iana_timezone text;

-- destinations.latitude / destinations.longitude — a single representative
-- point per destination, used by the weather job to call Open-Meteo (it
-- has no other way to know where a destination physically is; only
-- `airports` has coordinates, and those are airport locations, not the
-- destination's own). Same numeric precision as airports.latitude/
-- longitude (numeric(8,5)) for consistency.
--
-- The point should be where families actually stay, not a geometric
-- average. For a circuit destination (e.g. Andalusian Corridor: SVQ + AGP)
-- that means one representative base, not the midpoint of the legs — see
-- the andalusian-corridor UPDATE at the bottom of this file for why the
-- original midpoint was replaced. Per-leg weather rows for circuits are
-- explicitly out of scope for now, not silently ruled out — revisit if/when
-- that's wanted.
--
-- Nullable here for the same reason as iana_timezone above: this file
-- reruns on every push touching supabase/tables/**, so it must stay safe
-- before any backfill has happened. NOT NULL enforced separately once
-- backfilled — see the same backfill file.
ALTER TABLE destinations
  ADD COLUMN IF NOT EXISTS latitude  numeric(8,5),
  ADD COLUMN IF NOT EXISTS longitude numeric(8,5);

-- andalusian-corridor weather point: Málaga city centre (36.72130, -4.42140).
--
-- Replaces the original value 37.04645, -5.19610 — the simple average of the
-- SVQ and AGP airports, set by supabase/backfill/backfill_destination_coordinates.sql.
-- That point is an inland hill site near Antequera at ~477 m elevation: it
-- does not represent where families on this circuit stay, and it has no
-- sea, so the Marine API returned no
-- sea_surface_temperature there (weather_window_stats.sea_temp_c was NULL).
--
-- Only the weather pipeline reads destinations.latitude/longitude
-- (lib/weather/weatherSnapshotJob.ts, for Open-Meteo calls); no RPC or app
-- code does. Changing the point does NOT change any existing weather row —
-- the raw weather_snapshots / weather_daily_context rows for this
-- destination must be re-ingested afterwards, then Tasks 4a/4b/4c re-run.
--
-- Lives here, not only in the backfill file, because this file is what
-- deploy-supabase.yml applies on merge. It re-runs on every such deploy, so
-- it is an idempotent assignment, and THIS line is now the source of truth
-- for this destination's point — change it here if it ever moves again.
UPDATE destinations
   SET latitude = 36.72130, longitude = -4.42140
 WHERE slug = 'andalusian-corridor';
