-- One-off backfill: populates cell_price_history and destination_median_history
-- for every currently-valid run (per get_valid_history_run_ids()). Run this
-- manually via the Supabase SQL editor — it is NOT part of the automated
-- deploy-supabase.yml pipeline (that workflow re-runs on every unrelated push
-- to main; a backfill should only run when you actually want it to).
--
-- IDEMPOTENT: both INSERTs upsert on the tables' own UNIQUE constraints
-- (ON CONFLICT ... DO UPDATE). Re-running this script at any time — after a
-- new run becomes valid, or just to refresh — produces the same end state,
-- never duplicate rows. Safe to re-run as often as you like.
--
-- Ordering: cell_price_history is populated first; destination_median_history
-- is then computed FROM cell_price_history (not recomputed independently from
-- fare_snapshots), so the median always reflects exactly the cells that were
-- actually stored.
--
-- trip_type is not a fare_snapshots column — it's a stay-duration preference
-- (get_smart_recommendation/get_compliance_scenarios take it as a parameter),
-- not a property of an observed price. It's derived here purely from a
-- candidate date-pair's night count: 3-4 nights = 'city', 7-10 nights =
-- 'circuit' (matching get_compliance_scenarios.sql's fixed ranges, which are
-- disjoint, so every date-pair maps to at most one trip_type). Pairs outside
-- both ranges (5-6 nights, 11+ nights, etc.) belong to neither matrix and are
-- excluded entirely.
--
-- Destination-level scope only (no school/window, per prior discussion) —
-- candidate date-pairs are whatever departure/return dates actually have
-- snapshot data for a destination's airport pool in a given run, cross-joined
-- and filtered to a valid night count. Not a term-date-derived window.
--
-- Cheapest-per-cell = MIN(party_total_gbp) per leg across the WHOLE
-- destination airport pool (all pool airports x all 5 London airports),
-- inner-joined so a date-pair without both legs' data doesn't count.
-- Deliberately NOT the matrix UI's own array-order-dependent cell selection
-- (see CLAUDE.md "Known Issues" — cellMap in compliance-calculator.tsx),
-- which isn't guaranteed-cheapest and isn't well-defined to snapshot
-- historically.

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1 — cell_price_history
-- ═══════════════════════════════════════════════════════════════════════════

WITH valid_runs AS (
  SELECT run_id FROM get_valid_history_run_ids()
),
compositions AS (
  SELECT * FROM (VALUES
    (1::smallint, 1::smallint, 0::smallint),
    (2::smallint, 1::smallint, 0::smallint),
    (2::smallint, 2::smallint, 0::smallint),
    (2::smallint, 0::smallint, 1::smallint)
  ) AS c(adults, children, infants)
),
dest_pool AS (
  SELECT d.slug AS destination_slug, da.iata_code
  FROM destinations d
  JOIN destination_airports da
    ON da.destination_id = d.id
   AND (da.excluded IS NULL OR da.excluded = false)
),
-- Outbound leg: London -> destination pool. DISTINCT ON + ORDER BY price ASC
-- is the "MIN(party_total_gbp), never a raw row pull" duplicate-safe pattern
-- used throughout this feature, while also surfacing that row's observed_at.
outbound_cheapest AS (
  SELECT DISTINCT ON (fs.run_id, dp.destination_slug, comp.adults, comp.children, comp.infants, fs.departure_date)
    fs.run_id, dp.destination_slug, comp.adults, comp.children, comp.infants,
    fs.departure_date,
    fs.party_total_gbp AS outbound_gbp,
    fs.observed_at     AS outbound_observed_at
  FROM fare_snapshots fs
  JOIN dest_pool dp ON dp.iata_code = fs.destination_iata
  JOIN compositions comp
    ON comp.adults = fs.adults AND comp.children = fs.children AND comp.infants = fs.infants
  WHERE fs.origin_iata IN ('LHR','LGW','STN','LTN','LCY')
    AND fs.run_id IN (SELECT run_id FROM valid_runs)
  ORDER BY fs.run_id, dp.destination_slug, comp.adults, comp.children, comp.infants, fs.departure_date,
           fs.party_total_gbp ASC, fs.observed_at ASC
),
-- Return leg: destination pool -> London.
return_cheapest AS (
  SELECT DISTINCT ON (fs.run_id, dp.destination_slug, comp.adults, comp.children, comp.infants, fs.departure_date)
    fs.run_id, dp.destination_slug, comp.adults, comp.children, comp.infants,
    fs.departure_date AS return_date,
    fs.party_total_gbp AS return_gbp,
    fs.observed_at      AS return_observed_at
  FROM fare_snapshots fs
  JOIN dest_pool dp ON dp.iata_code = fs.origin_iata
  JOIN compositions comp
    ON comp.adults = fs.adults AND comp.children = fs.children AND comp.infants = fs.infants
  WHERE fs.destination_iata IN ('LHR','LGW','STN','LTN','LCY')
    AND fs.run_id IN (SELECT run_id FROM valid_runs)
  ORDER BY fs.run_id, dp.destination_slug, comp.adults, comp.children, comp.infants, fs.departure_date,
           fs.party_total_gbp ASC, fs.observed_at ASC
),
-- Inner join — a cell only counts if BOTH legs have a matching row this run.
-- Never interpolate or assume a missing leg's price.
cells AS (
  SELECT
    o.run_id, o.destination_slug, o.adults, o.children, o.infants,
    o.departure_date, r.return_date,
    (r.return_date - o.departure_date) AS nights,
    (o.outbound_gbp + r.return_gbp) AS cheapest_airfare_gbp,
    LEAST(o.outbound_observed_at, r.return_observed_at) AS observed_at
  FROM outbound_cheapest o
  JOIN return_cheapest r
    ON r.run_id = o.run_id
   AND r.destination_slug = o.destination_slug
   AND r.adults = o.adults AND r.children = o.children AND r.infants = o.infants
   AND r.return_date > o.departure_date
),
cells_typed AS (
  SELECT *,
    CASE
      WHEN nights BETWEEN 3 AND 4  THEN 'city'
      WHEN nights BETWEEN 7 AND 10 THEN 'circuit'
      ELSE NULL
    END AS trip_type
  FROM cells
)
INSERT INTO cell_price_history (
  run_id, destination_slug, trip_type, adults, children, infants,
  departure_date, return_date, observed_at, cheapest_airfare_gbp
)
SELECT run_id, destination_slug, trip_type, adults, children, infants,
       departure_date, return_date, observed_at, cheapest_airfare_gbp
FROM cells_typed
WHERE trip_type IS NOT NULL
ON CONFLICT (run_id, destination_slug, trip_type, adults, children, infants, departure_date, return_date)
DO UPDATE SET
  cheapest_airfare_gbp = EXCLUDED.cheapest_airfare_gbp,
  observed_at          = EXCLUDED.observed_at;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2 — destination_median_history (computed FROM cell_price_history above,
-- not recomputed independently from fare_snapshots)
-- ═══════════════════════════════════════════════════════════════════════════

WITH medians AS (
  SELECT
    run_id, destination_slug, trip_type, adults, children, infants,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cheapest_airfare_gbp) AS median_airfare_gbp,
    COUNT(*)          AS cell_count,
    MIN(observed_at)  AS observed_at
  FROM cell_price_history
  WHERE run_id IN (SELECT run_id FROM get_valid_history_run_ids())
  GROUP BY run_id, destination_slug, trip_type, adults, children, infants
)
INSERT INTO destination_median_history (
  run_id, destination_slug, trip_type, adults, children, infants,
  observed_at, median_airfare_gbp, cell_count
)
SELECT run_id, destination_slug, trip_type, adults, children, infants,
       observed_at, median_airfare_gbp, cell_count
FROM medians
ON CONFLICT (run_id, destination_slug, trip_type, adults, children, infants)
DO UPDATE SET
  median_airfare_gbp = EXCLUDED.median_airfare_gbp,
  cell_count         = EXCLUDED.cell_count,
  observed_at        = EXCLUDED.observed_at;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 3 — verification queries (run these after Parts 1-2 to see results)
-- ═══════════════════════════════════════════════════════════════════════════

-- Row counts
SELECT 'destination_median_history' AS table_name, COUNT(*) FROM destination_median_history
UNION ALL
SELECT 'cell_price_history', COUNT(*) FROM cell_price_history;

-- Full contents of destination_median_history, newest first
SELECT run_id, destination_slug, trip_type, adults, children, infants,
       observed_at, median_airfare_gbp, cell_count
FROM destination_median_history
ORDER BY observed_at DESC;

-- Per-run cell counts in cell_price_history (should match cell_count above
-- for the matching run/destination/trip_type/composition)
SELECT run_id, destination_slug, trip_type, adults, children, infants, COUNT(*) AS cells
FROM cell_price_history
GROUP BY run_id, destination_slug, trip_type, adults, children, infants
ORDER BY run_id;
