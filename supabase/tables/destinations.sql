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
-- For a circuit destination (e.g. Andalusian Corridor: SVQ + AGP), this is
-- explicitly the MIDPOINT/average of the circuit's legs, not one leg
-- picked over another — confirmed with the user rather than assumed (an
-- earlier pass silently picked "the coastal leg" without asking, which was
-- flagged and reverted). See
-- supabase/backfill/backfill_destination_coordinates.sql for the actual
-- values and the specific consequence this choice has for
-- weather_daily_context.sea_surface_temp_c on that destination. Per-leg
-- weather rows for circuits are explicitly out of scope for now, not
-- silently ruled out — revisit if/when that's wanted.
--
-- Nullable here for the same reason as iana_timezone above: this file
-- reruns on every push touching supabase/tables/**, so it must stay safe
-- before any backfill has happened. NOT NULL enforced separately once
-- backfilled — see the same backfill file.
ALTER TABLE destinations
  ADD COLUMN IF NOT EXISTS latitude  numeric(8,5),
  ADD COLUMN IF NOT EXISTS longitude numeric(8,5);
