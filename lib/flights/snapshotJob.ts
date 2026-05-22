/**
 * Weekly cross-sectional snapshot job.
 *
 * Two-stage pipeline (per CONTEXT.md):
 *   Stage 1 — google_flights_calendar call per leg direction × window.
 *             In-memory only — results are never written to any table.
 *   Stage 2 — google_flights detail call per promising date × London airport.
 *             Every returned result stored as its own fare_snapshots row.
 *
 * Borough-blind: fare_snapshots contains no borough data. Borough × window
 * resolution happens in the Layer 3 derived tables.
 *
 * Airport pool model:
 *   destination_airports holds one iata_code row per valid airport per destination.
 *   All (airport_a, airport_b) combinations are valid trip pairs, including same-airport
 *   round trips. Outbound = London → airport_a; return = airport_b → London.
 *   Pair combination is assembled in Layer 3 — the snapshot job collects independent
 *   one-way legs for every airport in each destination's pool.
 *
 * Pilot scope:
 *   Destinations: barcelona, andalusian-corridor, malta only.
 *   Date window:  outbound 22 Oct – 2 Nov 2026; trip durations 3–4 and 7–10 nights.
 *
 * Usage (programmatic):
 *   import { runSnapshotJob } from './snapshotJob';
 *   await runSnapshotJob({
 *     targetWindows: [{
 *       label: '2026-10-halfterm',
 *       outboundStart: '2026-10-22',
 *       outboundEnd:   '2026-11-02',
 *       returnStart:   '2026-10-25',
 *       returnEnd:     '2026-11-12',
 *     }],
 *   });
 *
 * Usage (direct, pilot):
 *   npx ts-node --project tsconfig.json lib/flights/snapshotJob.ts
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { fetchFlights, fetchCalendarLegs, type FlightResult, type CalendarLeg } from './fetchFlights';

// ── Config ────────────────────────────────────────────────────────────────────

const LONDON_ORIGINS = ['LGW', 'LHR', 'STN', 'LTN', 'LCY'] as const;

/** Destinations included in the pilot run. */
const PILOT_SLUGS = ['barcelona', 'andalusian-corridor', 'malta'] as const;

/** Max promising dates per direction to run Stage 2 detail calls against. */
const MAX_PROMISING_DATES = 8;

/** Default pilot party: 2 adults, 2 children, 0 infants. */
const DEFAULT_ADULTS = 2;
const DEFAULT_CHILDREN = 2;
const DEFAULT_INFANTS = 0;
const CURRENCY = 'GBP';

/** Minimum delay between API calls — stay within SearchAPI.io rate limits. */
const API_DELAY_MS = 300;

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface TargetWindow {
  /** Stored in snapshot_runs.target_windows, e.g. '2026-10-halfterm'. */
  label: string;
  /** First outbound departure date to search, YYYY-MM-DD. */
  outboundStart: string;
  /** Last outbound departure date to search, YYYY-MM-DD. */
  outboundEnd: string;
  /** First return departure date to search, YYYY-MM-DD. */
  returnStart: string;
  /** Last return departure date to search, YYYY-MM-DD. */
  returnEnd: string;
}

export interface JobConfig {
  targetWindows: TargetWindow[];
  snapshotType?: 'cross_sectional' | 'tracer'; // defaults to 'cross_sectional'
  adults?: number;
  children?: number;
  infants?: number;
}

export interface SnapshotJobResult {
  runId: string;
  total: number;
  success: number;
  failed: number;
}

// ── Internal types ────────────────────────────────────────────────────────────

/** Map from destination_id to its ordered airport pool. */
type AirportPoolMap = Map<string, string[]>;

interface CallCounters {
  total: number;
  success: number;
  failed: number;
}

interface Party {
  adults: number;
  children: number;
  infants: number;
}

// ── Supabase client ───────────────────────────────────────────────────────────

function getSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase env vars missing: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both required. Never use the anon key for server-side write jobs.');
  }
  return createClient(url, key);
}

// ── snapshot_runs bookkeeping ─────────────────────────────────────────────────

async function startRun(
  supabase: SupabaseClient,
  snapshotType: 'cross_sectional' | 'tracer',
  windows: TargetWindow[],
): Promise<string> {
  const { data, error } = await supabase
    .from('snapshot_runs')
    .insert({
      run_type: snapshotType,
      target_windows: windows.map(w => w.label),
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`snapshot_runs INSERT failed: ${error?.message ?? 'no data returned'}`);
  }
  return data.id as string;
}

async function finishRun(
  supabase: SupabaseClient,
  runId: string,
  counters: CallCounters,
  notes?: string,
): Promise<void> {
  const { error } = await supabase
    .from('snapshot_runs')
    .update({
      completed_at: new Date().toISOString(),
      total_calls: counters.total,
      success_calls: counters.success,
      failed_calls: counters.failed,
      ...(notes ? { notes } : {}),
    })
    .eq('id', runId);

  if (error) console.error('[snapshot] snapshot_runs UPDATE failed:', error.message);
}

// ── Reference data ────────────────────────────────────────────────────────────

/**
 * Loads the airport pool for each active pilot destination from destination_airports.
 * Returns a map of destination_id → iata_code[].
 */
async function loadDestinationAirports(supabase: SupabaseClient): Promise<AirportPoolMap> {
  // Step 1: resolve pilot slugs to destination IDs
  const { data: dests, error: destError } = await supabase
    .from('destinations')
    .select('id, slug')
    .in('slug', [...PILOT_SLUGS])
    .eq('active', true);

  if (destError) throw new Error(`destinations SELECT failed: ${destError.message}`);
  console.log(
    `[snapshot] destinations query: ${(dests ?? []).length} row(s) matched` +
    ` slugs=[${PILOT_SLUGS.join(', ')}] active=true`,
  );
  if (!dests || dests.length === 0) {
    throw new Error(`No active destinations found for pilot slugs: ${PILOT_SLUGS.join(', ')}`);
  }

  const destRows = dests as Array<{ id: string; slug: string }>;
  const destIds = destRows.map(d => d.id);
  const slugByDestId: Record<string, string> = Object.fromEntries(
    destRows.map(d => [d.id, d.slug]),
  );

  // Step 2: load airport pool for those destination IDs
  const { data: rows, error: airportError } = await supabase
    .from('destination_airports')
    .select('destination_id, iata_code')
    .in('destination_id', destIds);

  if (airportError) throw new Error(`destination_airports SELECT failed: ${airportError.message}`);
  console.log(
    `[snapshot] destination_airports query: ${(rows ?? []).length} row(s)` +
    ` for ${destIds.length} destination ID(s)`,
  );

  const poolMap: AirportPoolMap = new Map();
  for (const row of rows ?? []) {
    const destId = row.destination_id as string;
    const iata   = row.iata_code as string;
    if (!poolMap.has(destId)) poolMap.set(destId, []);
    poolMap.get(destId)!.push(iata);
  }

  for (const [destId, pool] of poolMap) {
    console.log(`[snapshot] ${slugByDestId[destId] ?? destId}: airport pool = [${pool.join(', ')}]`);
  }

  return poolMap;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── Calendar pre-filter (Stage 1) ─────────────────────────────────────────────

/**
 * Select up to MAX_PROMISING_DATES dates for Stage 2 detail calls.
 * Prioritises dates flagged is_lowest_price, then fills to cap by price ascending.
 */
function selectPromisingDates(legs: CalendarLeg[], max = MAX_PROMISING_DATES): string[] {
  const available = legs.filter(l => l.price !== null);
  if (available.length === 0) return [];

  const flagged = available.filter(l => l.isLowestPrice).map(l => l.date);
  const remaining = available
    .filter(l => !l.isLowestPrice)
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
    .map(l => l.date);

  return [...new Set([...flagged, ...remaining])].slice(0, max);
}

// ── Time helpers for fare_snapshots columns ───────────────────────────────────

/** Extract HH:MM from '2026-10-26 07:15', '2026-10-26T07:15', or '07:15'. */
function extractTime(apiTime: string): string {
  const parts = apiTime.trim().split(/[\sT]/);
  return parts[parts.length - 1].slice(0, 5);
}

/** Detect overnight flight when API returns full datetime strings. */
function isOvernight(depTime: string, arrTime: string): boolean {
  const dep = depTime.trim().split(/[\sT]/);
  const arr = arrTime.trim().split(/[\sT]/);
  if (dep.length >= 2 && arr.length >= 2) return dep[0] !== arr[0];
  return false;
}

// ── fare_snapshots insert ─────────────────────────────────────────────────────

async function insertFareSnapshots(
  supabase: SupabaseClient,
  runId: string,
  snapshotType: string,
  results: FlightResult[],
  departureDate: string,
  originIata: string,
  destinationIata: string,
  party: Party,
): Promise<{ ok: number; fail: number }> {
  if (results.length === 0) return { ok: 0, fail: 0 };

  // Track rank independently within each bucket (best / other)
  let bestRank = 1;
  let otherRank = 1;

  const rows = results.map(r => ({
    run_id: runId,
    snapshot_type: snapshotType,
    origin_iata: originIata,
    destination_iata: destinationIata,
    departure_date: departureDate,
    flight_number: r.flightNumber,
    airline_iata: r.airlineIata,
    departure_time: extractTime(r.departureTime),
    arrival_time: extractTime(r.arrivalTime),
    duration_minutes: r.durationMinutes,
    stops: r.stopCount,
    is_overnight: isOvernight(r.departureTime, r.arrivalTime),
    adults: party.adults,
    children: party.children,
    infants: party.infants,
    party_total_gbp: r.price,
    booking_token: r.bookingToken || null,
    result_bucket: r.isBestFlight ? 'best' : 'other',
    result_rank: r.isBestFlight ? bestRank++ : otherRank++,
    raw_json: r.rawJson,
  }));

  // Append-only — INSERT, never upsert
  const { error } = await supabase.from('fare_snapshots').insert(rows);

  if (error) {
    console.error(
      `[snapshot] fare_snapshots INSERT failed (${originIata}→${destinationIata} ${departureDate}): ${error.message}`,
    );
    return { ok: 0, fail: rows.length };
  }

  return { ok: rows.length, fail: 0 };
}

// ── Retry wrapper ─────────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 3,
): Promise<T | null> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const delay = 2 ** i * 1_000;
      console.warn(`[snapshot] ${label} attempt ${i + 1} failed — retry in ${delay}ms`, err);
      if (i < maxAttempts - 1) await sleep(delay);
    }
  }
  console.error(`[snapshot] ${label} — all ${maxAttempts} attempts failed`);
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── One direction per airport × window ───────────────────────────────────────

/**
 * Outbound: all 5 London airports → europeanIata.
 *   Calendar call uses comma-separated London origins (one API call covers all).
 *   Detail calls iterate each London airport individually.
 *
 * Return: europeanIata → all 5 London airports.
 *   Calendar call uses comma-separated London destinations (one API call covers all).
 *   Detail calls iterate each London airport individually.
 */
async function runLegDirection(
  supabase: SupabaseClient,
  runId: string,
  snapshotType: string,
  europeanIata: string,
  direction: 'outbound' | 'return',
  dateStart: string,
  dateEnd: string,
  party: Party,
  counters: CallCounters,
): Promise<void> {
  const londonBlock = LONDON_ORIGINS.join(',');
  const calendarOrigin = direction === 'outbound' ? londonBlock : europeanIata;
  const calendarDest   = direction === 'outbound' ? europeanIata : londonBlock;

  // Stage 1 — calendar pre-filter (in-memory, never persisted)
  const calendarLegs = await withRetry(
    () => fetchCalendarLegs({
      origin: calendarOrigin,
      destination: calendarDest,
      dateStart,
      dateEnd,
      currency: CURRENCY,
    }),
    `calendar ${direction} ${europeanIata} ${dateStart}..${dateEnd}`,
  );

  if (!calendarLegs || calendarLegs.length === 0) {
    console.warn(`[snapshot] No calendar data — ${direction} ${europeanIata} ${dateStart}..${dateEnd}`);
    return;
  }

  const promisingDates = selectPromisingDates(calendarLegs);
  const pricedCount = calendarLegs.filter(l => l.price !== null).length;
  console.log(
    `[snapshot] ${direction} ${europeanIata}: ${promisingDates.length} promising dates` +
    ` (from ${pricedCount} priced calendar entries)`,
  );

  // Stage 2 — detail calls per promising date × London airport
  for (const date of promisingDates) {
    for (const londonIata of LONDON_ORIGINS) {
      const origin      = direction === 'outbound' ? londonIata   : europeanIata;
      const destination = direction === 'outbound' ? europeanIata : londonIata;

      counters.total++;
      await sleep(API_DELAY_MS);

      const results = await withRetry(
        () => fetchFlights({
          origin,
          destination,
          outboundDate: date,
          adults: party.adults,
          children: party.children,
          currency: CURRENCY,
        }),
        `detail ${origin}→${destination} ${date}`,
      );

      if (!results) {
        counters.failed++;
        continue;
      }

      if (results.length === 0) {
        console.log(`[snapshot] 0 results — ${origin}→${destination} ${date}`);
        counters.success++;
        continue;
      }

      const { ok, fail } = await insertFareSnapshots(
        supabase, runId, snapshotType,
        results, date, origin, destination, party,
      );

      console.log(
        `[snapshot] ${origin}→${destination} ${date}: ${ok} rows inserted` +
        (fail ? `, ${fail} failed` : ''),
      );
      if (fail > 0) counters.failed++; else counters.success++;
    }
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runSnapshotJob(config: JobConfig): Promise<SnapshotJobResult> {
  const snapshotType = config.snapshotType ?? 'cross_sectional';
  const party: Party = {
    adults:   config.adults   ?? DEFAULT_ADULTS,
    children: config.children ?? DEFAULT_CHILDREN,
    infants:  config.infants  ?? DEFAULT_INFANTS,
  };

  console.log('[snapshot] job started', new Date().toISOString());
  console.log(
    `[snapshot] type=${snapshotType}  ` +
    `party=${party.adults}A+${party.children}C+${party.infants}I  ` +
    `windows=${config.targetWindows.map(w => w.label).join(', ')}`,
  );

  const supabase = getSupabase();
  const counters: CallCounters = { total: 0, success: 0, failed: 0 };

  // 1. Register run — every fare_snapshots row references this run_id
  let runId: string;
  try {
    runId = await startRun(supabase, snapshotType, config.targetWindows);
    console.log(`[snapshot] run_id=${runId}`);
  } catch (err) {
    console.error('[snapshot] Fatal — cannot register run:', err);
    throw err;
  }

  // 2. Load destination airport pools (pilot: barcelona, andalusian-corridor, malta only)
  let airportPoolMap: AirportPoolMap;
  try {
    airportPoolMap = await loadDestinationAirports(supabase);
    const totalAirports = [...airportPoolMap.values()].reduce((n, pool) => n + pool.length, 0);
    console.log(`[snapshot] ${airportPoolMap.size} destinations, ${totalAirports} airports in pools`);
    if (airportPoolMap.size === 0) {
      const msg = 'No rows in destination_airports for pilot slugs — seed the table before running.';
      await finishRun(supabase, runId, counters, msg);
      console.error(`[snapshot] ${msg}`);
      return { runId, ...counters };
    }
  } catch (err) {
    await finishRun(supabase, runId, counters, `destination_airports load failed: ${err}`);
    throw err;
  }

  // 3. Main loop: windows × destinations × airport pairs × directions
  //
  // For each destination pool, all (airport_a, airport_b) pairs are valid trip combinations,
  // including same-airport round trips. Because pairs share the same pool, the set of unique
  // outbound airports and unique return airports both equal the pool itself — so we iterate
  // the pool directly to avoid redundant API calls while covering all pair combinations.
  try {
    for (const window of config.targetWindows) {
      console.log(
        `[snapshot] window ${window.label}` +
        `  outbound ${window.outboundStart}..${window.outboundEnd}` +
        `  return ${window.returnStart}..${window.returnEnd}`,
      );

      for (const [destId, pool] of airportPoolMap) {
        const pairCount = pool.length * pool.length;
        console.log(
          `[snapshot] destination ${destId}: ${pool.length} airports → ${pairCount} pairs` +
          ` (airport_a × airport_b, including same-airport round trips)`,
        );

        // Outbound: London → each airport in pool (covers airport_a for all pairs)
        for (const airportA of pool) {
          await runLegDirection(
            supabase, runId, snapshotType,
            airportA,
            'outbound',
            window.outboundStart, window.outboundEnd,
            party, counters,
          );
        }

        // Return: each airport in pool → London (covers airport_b for all pairs)
        for (const airportB of pool) {
          await runLegDirection(
            supabase, runId, snapshotType,
            airportB,
            'return',
            window.returnStart, window.returnEnd,
            party, counters,
          );
        }
      }
    }
  } catch (err) {
    console.error('[snapshot] Unexpected error in main loop:', err);
    await finishRun(supabase, runId, counters, `Terminated with error: ${err}`);
    throw err;
  }

  // 4. Mark run complete
  await finishRun(supabase, runId, counters);
  console.log(
    `[snapshot] job complete  ${new Date().toISOString()}  ` +
    `total=${counters.total}  success=${counters.success}  failed=${counters.failed}`,
  );
  return { runId, ...counters };
}

// Direct execution — pilot config for October 2026 half-term
// Outbound: 22 Oct – 2 Nov 2026; trip durations 3–4 and 7–10 nights.
// Return range: outboundStart + 3 nights → outboundEnd + 10 nights.
// Production invocation goes through /pages/api/cron/flight-snapshot.ts
if (require.main === module) {
  runSnapshotJob({
    targetWindows: [{
      label:         '2026-10-halfterm',
      outboundStart: '2026-10-22',
      outboundEnd:   '2026-11-02',
      returnStart:   '2026-10-25', // 2026-10-22 + 3 nights
      returnEnd:     '2026-11-12', // 2026-11-02 + 10 nights
    }],
  }).catch(err => {
    console.error('[snapshot] fatal:', err);
    process.exit(1);
  });
}
