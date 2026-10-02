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
-- andalusian-corridor: a circuit (Seville/SVQ + Málaga/AGP legs).
--   CORRECTED: this file originally set the midpoint of the two airports
--   (37.04645, -5.19610). That point lands on an inland hill site near
--   Antequera at ~477 m — not where families stay, and with no sea data (sea_surface_temp_c came back NULL). It has been
--   replaced by Málaga city centre (36.72130, -4.42140), applied by the
--   UPDATE at the bottom of supabase/tables/destinations.sql, which is now
--   the source of truth for this row. The value below is kept identical so
--   re-running this file can never put the old midpoint back.
--   Seville  (SVQ airport): 37.41800, -5.89310
--   Málaga   (AGP airport): 36.67490, -4.49910
--   Weather point (Málaga city centre): 36.72130, -4.42140

-- Scope: only the 3 pilot destinations — the only rows live in this table
-- as of Phase 1 (see CLAUDE.md "Current Build Phase" / snapshotJob.ts
-- PILOT_SLUGS). If destination rows exist beyond these three, the final
-- SET NOT NULL below will fail until they're backfilled too — intentional,
-- same reasoning as backfill_destination_timezones.sql.

UPDATE destinations SET latitude = 41.38510, longitude =   2.17340 WHERE slug = 'barcelona';
UPDATE destinations SET latitude = 36.72130, longitude =  -4.42140 WHERE slug = 'andalusian-corridor';
UPDATE destinations SET latitude = 35.89890, longitude =  14.51460 WHERE slug = 'malta';

ALTER TABLE destinations ALTER COLUMN latitude  SET NOT NULL;
ALTER TABLE destinations ALTER COLUMN longitude SET NOT NULL;
