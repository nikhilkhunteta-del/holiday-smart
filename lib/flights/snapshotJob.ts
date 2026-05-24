/**
 * Weekly cross-sectional snapshot job.
 *
 * Architecture (Crawlio era — no calendar pre-filter):
 *   For each destination × airport × date × composition:
 *     - One outbound call:  LON → europeanIata
 *     - One return call:    europeanIata → LON
 *   Every result stored as its own fare_snapshots row.
 *
 * LON city code collapses all 5 London airports into one Crawlio call.
 * Individual airport attribution appears in response segments[0].from.
 *
 * Borough-blind: fare_snapshots contains no borough data. Borough × window
 * resolution happens in Layer 3 derived tables.
 *
 * Airport pool model:
 *   destination_airports holds one iata_code per valid European airport per destination.
 *   Outbound = LON → airport; return = airport → LON.
 *   Pair combinations are assembled in Layer 3 — the snapshot job collects independent
 *   one-way legs for every airport in each destination's pool.
 *
 * Standard run (21 destinations, 12 dates, 4 compositions, 2 directions):
 *   12 × 21 × 4 × 2 = 2,016 calls/run
 *
 * Pilot scope:
 *   Destinations: barcelona, andalusian-corridor, malta only.
 *   Date window:  22 Oct – 2 Nov 2026 (October half-term ±3 days).
 *
 * Usage (programmatic):
 *   import { runSnapshotJob } from './snapshotJob';
 *   await runSnapshotJob({ targetWindows: [OCTOBER_2026_HALFTERM] });
 *
 * Usage (direct, pilot):
 *   npx ts-node --project tsconfig.json lib/flights/snapshotJob.ts
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { fetchFlights, type FlightRow } from './fetchFlights';

// ── Config ────────────────────────────────────────────────────────────────────

/** LON city code returns all 5 London airports in one Crawlio call. */
const LON = 'LON';

/** Destinations included in the pilot run. */
const PILOT_SLUGS = ['barcelona', 'andalusian-corridor', 'malta'] as const;

const CURRENCY = 'GBP';

/** Minimum delay between API calls (ms). */
const API_DELAY_MS = 300;

// 4 standard family compositions — every row represents a real Holiday Smart user family.
export const STANDARD_COMPOSITIONS = [
  { adults: 1, children: 1, infants: 0 },  // 1A+1C — bucket-splitter unit
  { adults: 2, children: 1, infants: 0 },  // 2A+1C — single-child families
  { adults: 2, children: 2, infants: 0 },  // 2A+2C — canonical family / leaderboard baseline
  { adults: 2, children: 0, infants: 1 },  // 2A+1inf — infant-on-lap families
] as const;

export type Composition = (typeof STANDARD_COMPOSITIONS)[number];

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface TargetWindow {
  /** Stored in snapshot_runs.target_windows, e.g. '2026-10-halfterm'. */
  label: string;
  /** First date in the outbound + return scan range, YYYY-MM-DD. */
  dateStart: string;
  /** Last date in the outbound + return scan range, YYYY-MM-DD. */
  dateEnd: string;
}

export interface JobConfig {
  targetWindows: TargetWindow[];
  snapshotType?: 'cross_sectional' | 'tracer';
  /** Override compositions. Defaults to all 4 STANDARD_COMPOSITIONS. */
  compositions?: Composition[];
  /** Override pilot destination slugs. Defaults to PILOT_SLUGS. */
  destinationSlugs?: string[];
}

export interface SnapshotJobResult {
  runId: string;
  total: number;
  success: number;
  failed: number;
}

// ── Internal types ────────────────────────────────────────────────────────────

interface DestinationPool {
  destinationId: string;
  slug: string;
  airportCodes: string[];
}

interface Counters {
  total: number;
  success: number;
  failed: number;
}

// ── Supabase client ───────────────────────────────────────────────────────────

function getSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase env vars missing: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required.',
    );
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
  counters: Counters,
  notes?: string,
): Promise<void> {
  const { error } = await supabase
    .from('snapshot_runs')
    .update({
      completed_at:  new Date().toISOString(),
      total_calls:   counters.total,
      success_calls: counters.success,
      failed_calls:  counters.failed,
      ...(notes ? { notes } : {}),
    })
    .eq('id', runId);

  if (error) console.error('[snapshot] snapshot_runs UPDATE failed:', error.message);
}

// ── Reference data ────────────────────────────────────────────────────────────

async function loadDestinationPools(
  supabase: SupabaseClient,
  slugs: readonly string[],
): Promise<DestinationPool[]> {
  const { data: destData, error: destErr } = await supabase
    .from('destinations')
    .select('id, slug')
    .in('slug', [...slugs]);

  if (destErr) throw new Error(`destinations query failed: ${destErr.message}`);

  const dests = (destData ?? []) as Array<{ id: string; slug: string }>;
  console.log(`[snapshot] destinations: ${dests.length} row(s)`);

  if (dests.length === 0) {
    console.warn(`[snapshot] WARNING: no destinations matched slugs [${slugs.join(', ')}]`);
    return [];
  }

  const destIds = dests.map(d => d.id);

  const { data: airportData, error: airportErr } = await supabase
    .from('destination_airports')
    .select('destination_id, iata_code')
    .in('destination_id', destIds)
    .eq('excluded', false);

  if (airportErr) throw new Error(`destination_airports query failed: ${airportErr.message}`);

  const airports = (airportData ?? []) as Array<{ destination_id: string; iata_code: string }>;
  console.log(`[snapshot] destination_airports: ${airports.length} row(s)`);

  const codesByDestId: Record<string, string[]> = {};
  for (const row of airports) {
    (codesByDestId[row.destination_id] ??= []).push(row.iata_code);
  }

  const pools = dests
    .map(d => ({ destinationId: d.id, slug: d.slug, airportCodes: codesByDestId[d.id] ?? [] }))
    .filter(d => d.airportCodes.length > 0);

  for (const dest of pools) {
    console.log(`[snapshot] ${dest.slug}: pool = [${dest.airportCodes.join(', ')}]`);
  }

  return pools;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Generate every date from start to end inclusive. */
function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  let cur = start;
  while (cur <= end) {
    dates.push(cur);
    cur = addDays(cur, 1);
  }
  return dates;
}

// ── fare_snapshots insert ─────────────────────────────────────────────────────

async function insertFareSnapshots(
  supabase: SupabaseClient,
  runId: string,
  snapshotType: string,
  rows: FlightRow[],
  departureDate: string,
): Promise<{ ok: number; fail: number }> {
  if (rows.length === 0) return { ok: 0, fail: 0 };

  const records = rows.map(r => ({
    run_id:           runId,
    snapshot_type:    snapshotType,
    departure_date:   departureDate,
    origin_iata:      r.origin_iata,
    destination_iata: r.destination_iata,
    flight_number:    r.flight_number,
    airline_iata:     r.airline_iata,
    departure_time:   r.departure_time,
    arrival_time:     r.arrival_time,
    duration_minutes: r.duration_minutes,
    stops:            r.stops,
    aircraft_type:    r.aircraft_type,
    is_overnight:     r.is_overnight,
    adults:           r.adults,
    children:         r.children,
    infants:          r.infants,
    party_total_gbp:  r.party_total_gbp,
    booking_token:    r.booking_token,
    result_bucket:    r.result_bucket,
    result_rank:      r.result_rank,
    raw_json:         r.raw_json,
  }));

  // Append-only — INSERT, never upsert
  const { error } = await supabase.from('fare_snapshots').insert(records);

  if (error) {
    console.error(
      `[snapshot] INSERT failed (${rows[0]?.origin_iata}→${rows[0]?.destination_iata} ${departureDate}): ${error.message}`,
    );
    return { ok: 0, fail: records.length };
  }

  return { ok: records.length, fail: 0 };
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

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runSnapshotJob(config: JobConfig): Promise<SnapshotJobResult> {
  const snapshotType   = config.snapshotType  ?? 'cross_sectional';
  const compositions   = config.compositions  ?? [...STANDARD_COMPOSITIONS];
  const destinationSlugs = config.destinationSlugs ?? [...PILOT_SLUGS];

  console.log('[snapshot] job started', new Date().toISOString());
  console.log(
    `[snapshot] type=${snapshotType}  ` +
    `compositions=${compositions.length}  ` +
    `windows=${config.targetWindows.map(w => w.label).join(', ')}`,
  );

  const supabase = getSupabase();
  const counters: Counters = { total: 0, success: 0, failed: 0 };

  // 1. Register run
  let runId: string;
  try {
    runId = await startRun(supabase, snapshotType, config.targetWindows);
    console.log(`[snapshot] run_id=${runId}`);
  } catch (err) {
    console.error('[snapshot] Fatal — cannot register run:', err);
    throw err;
  }

  // 2. Load destination airport pools
  let destinations: DestinationPool[];
  try {
    destinations = await loadDestinationPools(supabase, destinationSlugs);
    if (destinations.length === 0) {
      const msg = 'No airport pools loaded — seed destinations and destination_airports first.';
      await finishRun(supabase, runId, counters, msg);
      console.error(`[snapshot] ${msg}`);
      return { runId, ...counters };
    }
  } catch (err) {
    await finishRun(supabase, runId, counters, `destination_airports load failed: ${err}`);
    throw err;
  }

  // 3. Main loop: window × destination × airport × date × composition × direction
  try {
    for (const window of config.targetWindows) {
      const dates = dateRange(window.dateStart, window.dateEnd);
      console.log(
        `[snapshot] window ${window.label}: ${dates.length} dates ` +
        `(${window.dateStart} – ${window.dateEnd})`,
      );

      for (const dest of destinations) {
        console.log(`[snapshot] ${dest.slug}: pool = [${dest.airportCodes.join(', ')}]`);

        for (const europeanIata of dest.airportCodes) {
          for (const date of dates) {
            for (const comp of compositions) {
              const compLabel = `${comp.adults}A+${comp.children}C+${comp.infants}I`;

              // Outbound: LON → europeanIata
              counters.total++;
              await sleep(API_DELAY_MS);

              const outbound = await withRetry(
                () => fetchFlights({
                  origin:      LON,
                  destination: europeanIata,
                  date,
                  adults:   comp.adults,
                  children: comp.children,
                  infants:  comp.infants,
                }),
                `outbound LON→${europeanIata} ${date} ${compLabel}`,
              );

              if (!outbound) {
                counters.failed++;
              } else {
                const { ok, fail } = await insertFareSnapshots(
                  supabase, runId, snapshotType, outbound, date,
                );
                console.log(
                  `[snapshot] LON→${europeanIata} ${date} ${compLabel}: ${ok} rows` +
                  (fail ? ` (${fail} failed)` : ''),
                );
                if (fail > 0) counters.failed++; else counters.success++;
              }

              // Return: europeanIata → LON
              counters.total++;
              await sleep(API_DELAY_MS);

              const inbound = await withRetry(
                () => fetchFlights({
                  origin:      europeanIata,
                  destination: LON,
                  date,
                  adults:   comp.adults,
                  children: comp.children,
                  infants:  comp.infants,
                }),
                `return ${europeanIata}→LON ${date} ${compLabel}`,
              );

              if (!inbound) {
                counters.failed++;
              } else {
                const { ok, fail } = await insertFareSnapshots(
                  supabase, runId, snapshotType, inbound, date,
                );
                console.log(
                  `[snapshot] ${europeanIata}→LON ${date} ${compLabel}: ${ok} rows` +
                  (fail ? ` (${fail} failed)` : ''),
                );
                if (fail > 0) counters.failed++; else counters.success++;
              }
            }
          }
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

// ── Direct execution — October 2026 half-term pilot ───────────────────────────

export const OCTOBER_2026_HALFTERM: TargetWindow = {
  label:     '2026-10-halfterm',
  dateStart: '2026-10-22',
  dateEnd:   '2026-11-02',   // 12 dates (window ±3 days around half-term)
};

if (require.main === module) {
  runSnapshotJob({
    targetWindows: [OCTOBER_2026_HALFTERM],
  }).catch(err => {
    console.error('[snapshot] fatal:', err);
    process.exit(1);
  });
}
