/**
 * Nightly snapshot job — run via Vercel Cron or a standalone Node process.
 *
 * For each upcoming borough break window × popular destination, fetches
 * round-trip and calendar pricing then upserts into Supabase so UI
 * components always read pre-cached data.
 *
 * Invoke:
 *   npx ts-node --project tsconfig.json lib/flights/snapshotJob.ts
 * Or trigger from /pages/api/cron/flight-snapshot.ts (Vercel Cron).
 */

import { createClient } from '@supabase/supabase-js';
import { fetchFlights, fetchCalendarLegs } from './fetchFlights';

// ── Config ────────────────────────────────────────────────────────────────────

const LONDON_ORIGINS = ['LHR', 'LGW', 'STN', 'LTN', 'LCY'] as const;

// Most-searched destinations for London families — extend as needed
const DESTINATIONS = [
  'BCN', 'AGP', 'PMI', 'ALC', 'FAO', 'LIS',
  'FCO', 'NAP', 'VCE', 'PSA', 'BRI',
  'ATH', 'HER', 'RHO', 'CFU',
  'DUB', 'AMS', 'CDG', 'NCE', 'MRS',
  'PRG', 'BUD', 'WAW', 'OPO',
  'TFS', 'FUE', 'ACE', 'LPA',
  'MBJ', 'CUN', 'JFK',
] as const;

const ADULTS = 2;
const CHILDREN = 2;
const CURRENCY = 'GBP';

// How many months ahead to pull calendar data for
const CALENDAR_MONTHS_AHEAD = 4;

// ── Supabase ──────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase env vars missing');
  return createClient(url, key);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface BoroughWindow {
  borough: string;
  term_label: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Exponential back-off retry for transient API failures
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  attempts = 3,
): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const delay = 2 ** i * 1000;
      console.warn(`[snapshot] ${label} attempt ${i + 1} failed — retry in ${delay}ms`, err);
      if (i < attempts - 1) await sleep(delay);
    }
  }
  console.error(`[snapshot] ${label} — all attempts failed, skipping`);
  return null;
}

// ── Fetch upcoming borough windows ────────────────────────────────────────────

async function fetchUpcomingWindows(supabase: ReturnType<typeof getSupabase>): Promise<BoroughWindow[]> {
  const today = isoDate(new Date());
  const horizon = addDays(today, CALENDAR_MONTHS_AHEAD * 31);

  const { data, error } = await supabase
    .from('borough_term_dates')
    .select('borough, term_label, start_date, end_date')
    .gte('start_date', today)
    .lte('start_date', horizon)
    .order('start_date', { ascending: true });

  if (error) throw new Error(`[snapshot] borough_term_dates query failed: ${error.message}`);
  return (data ?? []) as BoroughWindow[];
}

// ── Flight snapshot ───────────────────────────────────────────────────────────

async function snapshotRouteFlights(
  supabase: ReturnType<typeof getSupabase>,
  window: BoroughWindow,
  origin: string,
  destination: string,
) {
  const results = await withRetry(
    () => fetchFlights({
      origin,
      destination,
      outboundDate: window.start_date,
      returnDate: window.end_date,
      adults: ADULTS,
      children: CHILDREN,
      currency: CURRENCY,
    }),
    `flights ${origin}→${destination} ${window.start_date}`,
  );

  if (!results || results.length === 0) return;

  const cheapest = results.reduce((a, b) => (a.price < b.price ? a : b));

  const { error } = await supabase
    .from('flight_snapshots')
    .upsert({
      borough: window.borough,
      term_label: window.term_label,
      outbound_date: window.start_date,
      return_date: window.end_date,
      origin,
      destination,
      cheapest_price: cheapest.price,
      cheapest_carrier: cheapest.carrier,
      cheapest_booking_token: cheapest.bookingToken,
      result_count: results.length,
      raw_results: results,
      snapshotted_at: new Date().toISOString(),
    }, {
      onConflict: 'borough,term_label,origin,destination,outbound_date',
    });

  if (error) {
    console.error(`[snapshot] upsert failed for ${origin}→${destination}:`, error.message);
  }
}

// ── Calendar snapshot ─────────────────────────────────────────────────────────

async function snapshotCalendar(
  supabase: ReturnType<typeof getSupabase>,
  origin: string,
  destination: string,
  year: number,
  month: number,
) {
  const legs = await withRetry(
    () => fetchCalendarLegs({ origin, destination, year, month, currency: CURRENCY }),
    `calendar ${origin}→${destination} ${year}-${String(month).padStart(2, '0')}`,
  );

  if (!legs || legs.length === 0) return;

  const rows = legs.map(l => ({
    origin,
    destination,
    date: l.date,
    price: l.price,
    currency: l.currency,
    snapshotted_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('calendar_price_snapshots')
    .upsert(rows, { onConflict: 'origin,destination,date' });

  if (error) {
    console.error(`[snapshot] calendar upsert failed ${origin}→${destination}:`, error.message);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function runSnapshotJob() {
  console.log('[snapshot] job started', new Date().toISOString());

  const supabase = getSupabase();
  const windows = await fetchUpcomingWindows(supabase);
  console.log(`[snapshot] ${windows.length} upcoming borough windows`);

  // Calendar snapshots — one pass per origin × destination × month
  const calendarSeen = new Set<string>();
  const today = new Date();

  for (const destination of DESTINATIONS) {
    for (let m = 0; m < CALENDAR_MONTHS_AHEAD; m++) {
      const target = new Date(today.getFullYear(), today.getMonth() + m, 1);
      const year = target.getFullYear();
      const month = target.getMonth() + 1;

      for (const origin of LONDON_ORIGINS) {
        const key = `${origin}-${destination}-${year}-${month}`;
        if (calendarSeen.has(key)) continue;
        calendarSeen.add(key);
        await snapshotCalendar(supabase, origin, destination, year, month);
        await sleep(300); // stay within SearchAPI.io rate limits
      }
    }
  }

  // Flight snapshots — one per window × origin × destination
  for (const window of windows) {
    for (const destination of DESTINATIONS) {
      for (const origin of LONDON_ORIGINS) {
        await snapshotRouteFlights(supabase, window, origin, destination);
        await sleep(300);
      }
    }
  }

  console.log('[snapshot] job complete', new Date().toISOString());
}

// Allow direct execution: ts-node lib/flights/snapshotJob.ts
if (require.main === module) {
  runSnapshotJob().catch(err => {
    console.error('[snapshot] fatal:', err);
    process.exit(1);
  });
}
