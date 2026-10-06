/**
 * Task 4c: fills weather_window_stats.severe_rain_warning_years for the SAME
 * (destination_id, window_start, window_end) row Tasks 4a/4b already wrote — a PATCH on
 * the PK sending only the severe-rain columns, so nothing else is touched and no second row can
 * be created (same PATCH-vs-upsert reasoning as deriveWindowStatsRemainder.ts).
 *
 * ── Definition (SEASONAL, not annual) ───────────────────────────────────────
 * A day is "severe rain" when its total daylight precipitation (sum of precipitation_mm
 * over is_daylight hours — the same per-day measure Task 4a uses for washout) is
 * STRICTLY ABOVE the severeRainPercentile-th percentile of that destination's WET days
 * (daylight total >= wetDayMinMm). Linear-interpolation percentile. The effective threshold
 * is the HIGHER of that percentile value and the fixed floor severeRainMinMm, so a dry
 * destination's p95 can't make a modest shower count as "severe".
 *
 * The pool is every ingested raw day for the destination across the strip years
 * (WEATHER_THRESHOLDS.stripYearSpan). The raw table currently holds only ~15 Oct to
 * 5 Nov of each year, NOT the whole year, so this threshold is a late-October figure.
 * Anywhere this definition is described, say so.
 *
 * severe_rain_warning_years = how many of the strip years had at least one day inside
 * the window's own calendar dates (same month/day in every year) above the threshold.
 *
 * The effective threshold (mm) is stored alongside the count in severe_rain_threshold_mm, and
 * the flagged years themselves in severe_rain_years ("2019, 2024" — same format as
 * sea_temp_years; NULL when no year was flagged).
 *
 * Inputs (see derivationInputs.ts): --slug, --window-start, --window-end, and the mode:
 *   (default)          dry run — compute and print only; writes nothing
 *   --write            also PATCH the one existing row
 *
 * Same transport as 4a/4b: raw PostgREST, credentials injected by the agent proxy. Run with:
 *   NODE_USE_ENV_PROXY=1 npx tsx lib/weather/deriveSevereRainWarning.ts \
 *     --slug=barcelona --window-start=2026-10-19 --window-end=2026-10-30 [--write]
 */

import { addDays } from '../flights/snapshotJob';
import { WEATHER_THRESHOLDS } from './thresholds';
import { parseDerivationArgs, loadDestination } from './derivationInputs';
import { formatYears } from './formatYears';

const SUPABASE_REST = 'https://mlqkicbifcwjvfagtdbc.supabase.co/rest/v1';


function qs(pairs: Array<[string, string]>): string {
  return new URLSearchParams(pairs).toString();
}

async function pgFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${SUPABASE_REST}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PostgREST ${init.method ?? 'GET'} ${path} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const monthDay = (d: string) => d.slice(5);
const withYear = (md: string, y: number) => `${y}-${md}`;

/** Linear-interpolation percentile (same as Postgres PERCENTILE_CONT), p in [0,1]. */
function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

async function main() {
  const { slug, windowStart, windowEnd, write } = parseDerivationArgs();
  const dayCount = Math.round((Date.parse(windowEnd) - Date.parse(windowStart)) / 86_400_000) + 1;
  const windowMonthDays = new Set(Array.from({ length: dayCount }, (_, d) => monthDay(addDays(windowStart, d))));
  console.log(`[4c] ${slug} ${windowStart}..${windowEnd} (${dayCount} days) — ${write ? 'WRITE' : 'DRY RUN'}`);

  const destinationId = (await loadDestination(pgFetch, slug)).id;

  // The 4a/4b row must already exist — this task fills one column, it does not originate it.
  const rowFilter: Array<[string, string]> = [
    ['destination_id', `eq.${destinationId}`],
    ['window_start', `eq.${windowStart}`],
    ['window_end', `eq.${windowEnd}`],
  ];
  const before = (await pgFetch(`/weather_window_stats?${qs([['select', '*'], ...rowFilter])}`)) as Array<Record<string, unknown>>;
  if (before.length !== 1) throw new Error(`expected exactly one existing row, found ${before.length}`);
  console.log('[4c] row BEFORE:');
  console.log(JSON.stringify(before[0], null, 2));

  // Strip years: same probe as 4a/4b (years with data at the window start, most recent N).
  const probe = (await pgFetch(
    `/weather_snapshots?${qs([
      ['select', 'observed_year,observed_date'],
      ['destination_id', `eq.${destinationId}`],
      ['observed_hour', 'eq.12'],
    ])}`,
  )) as Array<{ observed_year: number; observed_date: string }>;
  const allYears = Array.from(
    new Set(probe.filter(r => monthDay(r.observed_date) === monthDay(windowStart)).map(r => r.observed_year)),
  ).sort((a, b) => a - b);
  const stripYears = allYears.slice(-WEATHER_THRESHOLDS.stripYearSpan);
  if (stripYears.length < WEATHER_THRESHOLDS.stripYearSpan) {
    console.warn(`[4c] WARNING: only ${stripYears.length} strip year(s) found (expected ${WEATHER_THRESHOLDS.stripYearSpan})`);
  }

  // Per strip year: EVERY ingested day (not just the window) -> daylight total per day.
  // Fetched per year (~22 days x 24h, under PostgREST's 1000-row cap) and guarded below.
  type Day = { date: string; year: number; mm: number };
  const pool: Day[] = [];
  for (const y of stripYears) {
    const rows = (await pgFetch(
      `/weather_snapshots?${qs([
        ['select', 'observed_date,precipitation_mm'],
        ['destination_id', `eq.${destinationId}`],
        ['observed_year', `eq.${y}`],
        ['is_daylight', 'eq.true'],
      ])}`,
    )) as Array<{ observed_date: string; precipitation_mm: number | string }>;
    if (rows.length >= 1000) throw new Error(`year ${y}: ${rows.length} rows hits PostgREST's row cap — paginate`);
    const byDate = new Map<string, number>();
    for (const r of rows) byDate.set(r.observed_date, (byDate.get(r.observed_date) ?? 0) + Number(r.precipitation_mm));
    for (const [date, mm] of byDate) pool.push({ date, year: y, mm });
  }

  const dates = pool.map(d => d.date).sort();
  const wet = pool.filter(d => d.mm >= WEATHER_THRESHOLDS.wetDayMinMm);
  const percentileMm = percentile(wet.map(d => d.mm), WEATHER_THRESHOLDS.severeRainPercentile / 100);
  const threshold = Math.max(percentileMm, WEATHER_THRESHOLDS.severeRainMinMm);

  const flagged = pool
    .filter(d => windowMonthDays.has(monthDay(d.date)) && d.mm > threshold)
    .sort((a, b) => a.date.localeCompare(b.date));
  const flaggedYears = [...new Set(flagged.map(d => d.year))].sort((a, b) => a - b);
  const count = flaggedYears.length;

  console.log(`\n[4c] pool: ${pool.length} days across ${stripYears.length} strip years (${stripYears[0]}..${stripYears.at(-1)}), ` +
    `ingested range ${dates[0]}..${dates.at(-1)} (seasonal, NOT whole-year); ${wet.length} wet days (>= ${WEATHER_THRESHOLDS.wetDayMinMm} mm)`);
  console.log(
    `[4c] threshold: p${WEATHER_THRESHOLDS.severeRainPercentile} of wet days = ${percentileMm.toFixed(4)} mm, ` +
    `floor = ${WEATHER_THRESHOLDS.severeRainMinMm} mm -> effective ${threshold.toFixed(4)} mm (strictly above)`,
  );
  console.log(`[4c] flagged days in window: ${flagged.map(d => `${d.date} ${d.mm.toFixed(1)}mm`).join('; ') || 'none'}`);
  const severeRainYears = flaggedYears.length === 0 ? null : formatYears(flaggedYears);
  console.log(`[4c] severe_rain_warning_years = ${count} of ${stripYears.length} (${flaggedYears.join(', ') || 'none'})`);
  console.log(`[4c] severe_rain_years = ${severeRainYears === null ? 'NULL' : `'${severeRainYears}'`}`);

  if (!write) {
    console.log('\n[4c] dry run — nothing written.');
    return;
  }

  // PATCH on the PK, sending only the severe-rain columns; the row is verified to exist above.
  const out = (await pgFetch(`/weather_window_stats?${qs(rowFilter)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      severe_rain_warning_years: count,
      severe_rain_threshold_mm: Math.round(threshold * 100) / 100, // numeric(5,2)
      // Explicit NULL when nothing was flagged, so a stale list can never survive a re-run.
      severe_rain_years: severeRainYears,
      computed_at: new Date().toISOString(),
    }),
  })) as Array<Record<string, unknown>>;
  if (out.length !== 1) throw new Error(`expected to update exactly 1 row, updated ${out.length}`);
  console.log('\n[4c] row AFTER:');
  console.log(JSON.stringify(out[0], null, 2));

  const all = (await pgFetch(
    `/weather_window_stats?${qs([['select', 'window_start,window_end'], ['destination_id', `eq.${destinationId}`]])}`,
  )) as unknown[];
  const sameWindow = (await pgFetch(`/weather_window_stats?${qs([['select', 'destination_id'], ...rowFilter])}`)) as unknown[];
  console.log(`\n[4c] rows for ${slug}: ${all.length}; rows for this window: ${sameWindow.length}`);
}

main().catch(err => {
  console.error('[4c] fatal:', err);
  process.exit(1);
});
