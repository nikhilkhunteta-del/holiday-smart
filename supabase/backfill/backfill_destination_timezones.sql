-- One-off backfill: populates destinations.iana_timezone for the 3 pilot
-- destinations, then enforces NOT NULL now that every existing row has a
-- value. Run this manually via the Supabase SQL editor — it is NOT part of
-- the automated deploy-supabase.yml pipeline (that workflow only picks up
-- supabase/tables/**.sql and supabase/rpc/**.sql; this folder is excluded
-- on purpose, same convention as backfill_price_history.sql).
--
-- IDEMPOTENT: safe to re-run — the UPDATEs are unconditional per-slug
-- assignments (not INSERTs), and SET NOT NULL is a no-op once already set.
--
-- Scope: only the 3 pilot destinations (barcelona, andalusian-corridor,
-- malta) — the only destinations live in this table as of Phase 1 (see
-- CLAUDE.md "Current Build Phase" / snapshotJob.ts PILOT_SLUGS). If
-- destination rows exist beyond these three, the final SET NOT NULL below
-- will fail until they're backfilled too — that's intentional: it surfaces
-- any destination this script doesn't know about rather than silently
-- leaving it NULL.

UPDATE destinations SET iana_timezone = 'Europe/Madrid' WHERE slug = 'barcelona';
UPDATE destinations SET iana_timezone = 'Europe/Madrid' WHERE slug = 'andalusian-corridor';
UPDATE destinations SET iana_timezone = 'Europe/Malta'  WHERE slug = 'malta';

ALTER TABLE destinations ALTER COLUMN iana_timezone SET NOT NULL;
