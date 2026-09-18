-- One-off backfill: populates destinations.latitude/longitude for the 3
-- pilot destinations, then enforces NOT NULL now that every existing row
-- has a value. Run this manually via the Supabase SQL editor — it is NOT
-- part of the automated deploy-supabase.yml pipeline (that workflow only
-- picks up supabase/tables/**.sql and supabase/rpc/**.sql; this folder is
-- excluded on purpose, same convention as every other backfill file here).
--
-- IDEMPOTENT: safe to re-run — the UPDATEs are unconditional per-slug
-- assignments (not INSERTs), and SET NOT NULL is a no-op once already set.
--
-- barcelona / malta: single-point destinations, coordinates are just the
-- city/island centre — no ambiguity.
--
-- andalusian-corridor: a circuit (Seville/SVQ + Málaga/AGP legs). Per an
-- explicit decision with the user (not assumed — an earlier pass had
-- silently picked "the coastal leg," which was flagged and reverted), this
-- is the MIDPOINT of the two airports, not either leg individually:
--   Seville  (SVQ): 37.41800, -5.89310
--   Málaga   (AGP): 36.67490, -4.49910
--   Midpoint:       37.04645, -5.19610  (simple average — fine at this
--   ~140km separation, no need for geodesic precision for a single
--   representative point)
-- CONSEQUENCE WORTH KNOWING: this midpoint lands inland (roughly the
-- Antequera area of Málaga province), not on the coast. The weather job's
-- Marine Weather API call for sea_surface_temperature at this point will
-- likely return no usable data — weather_daily_context.sea_surface_temp_c
-- for andalusian-corridor may end up NULL for every row, which the column
-- already allows, but this is a direct, foreseeable consequence of the
-- midpoint choice rather than a bug if/when it happens.
--
-- Scope: only the 3 pilot destinations — the only rows live in this table
-- as of Phase 1 (see CLAUDE.md "Current Build Phase" / snapshotJob.ts
-- PILOT_SLUGS). If destination rows exist beyond these three, the final
-- SET NOT NULL below will fail until they're backfilled too — intentional,
-- same reasoning as backfill_destination_timezones.sql.

UPDATE destinations SET latitude = 41.38510, longitude =   2.17340 WHERE slug = 'barcelona';
UPDATE destinations SET latitude = 37.04645, longitude =  -5.19610 WHERE slug = 'andalusian-corridor';
UPDATE destinations SET latitude = 35.89890, longitude =  14.51460 WHERE slug = 'malta';

ALTER TABLE destinations ALTER COLUMN latitude  SET NOT NULL;
ALTER TABLE destinations ALTER COLUMN longitude SET NOT NULL;
