/**
 * Task 4e: the Weather tab's temperature and daylight card figures, for the SAME
 * (destination_id, window_start, window_end) row Tasks 4a/4b/4c already wrote — a PATCH on the
 * PK sending only the columns computed here, so nothing else is touched and no second row can be
 * created (same PATCH-vs-upsert reasoning as deriveWindowStatsRemainder.ts).
 *
 * Computed here (headline years, i.e. the last WEATHER_THRESHOLDS.headlineYearSpan):
 *   morning_feelslike_c     median apparent temperature over daylight hours starting before 12:00
 *   afternoon_feelslike_c   median over daylight hours starting 12:00–17:59
 *   evening_feelslike_c     median over the evening hours 4b uses: 18:00 to min(sunset + 2h, 22:00)
 *   sunset_mid_window       estimated sunset ("HH:MM") on the window's middle day, target year
 *                           (same middle day as 4b's daylight_hours_minutes)
 *   clock_change_date       the day the clocks change inside the window, target year; NULL if none
 *   sunset_before_change / sunset_after_change
 *                           estimated sunset the day before / the day of that change; NULL if none
 *
 * Medians are stored to two decimals and rounded to whole degrees only for display. The old
 * P10/P90 columns (daytime_/evening_feelslike_low/high_c, Task 4b) are left as they are.
 * Sunsets come from estimateSunset() (sunsetEstimate.ts): stored history, no Open-Meteo call.
 *
 * Preview by default: computes and prints the columns, writes nothing. --write PATCHes the row
 * (which must already exist). Run with:
 *   NODE_USE_ENV_PROXY=1 npx tsx lib/weather/deriveCardFigures.ts \
 *     --slug=barcelona --window-start=2026-10-24 --window-end=2026-11-01 [--write]
 */

import { addDays } from '../flights/snapshotJob';
import { WEATHER_THRESHOLDS } from './thresholds';
import { parseDerivationArgs, loadDestination } from './derivationInputs';
import { findClockChange } from './localTime';
import { estimateSunset } from './sunsetEstimate';

const SUPABASE_REST = 'https://mlqkicbifcwjvfagtdbc.supabase.co/rest/v1';

/** Day parts, by the hour each reading starts. Evening matches Task 4b exactly. */
const MORNING_END_H = 12;
const AFTERNOON_END_H = 18;
const EVENING_AFTER_SUNSET_H = 2;
const EVENING_CAP_H = 22;

type Snap = { observed_date: string; observed_hour: number; apparent_temperature_c: number | string | null; is_daylight: boolean };
type Daily = { observed_date: string; sunset_local: string };

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
const hhmmToMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function median(values: number[]): number {
  if (values.length === 0) throw new Error('median of no values');
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return Math.round(m * 100) / 100; // numeric(4,2)-style storage; display rounds to whole degrees
}

async function main() {
  const { slug, windowStart, windowEnd, write } = parseDerivationArgs();
  const dayCount = Math.round((Date.parse(windowEnd) - Date.parse(windowStart)) / 86_400_000) + 1;
  const windowMonthDays = Array.from({ length: dayCount }, (_, d) => monthDay(addDays(windowStart, d)));
  console.log(`[4e] ${slug} ${windowStart}..${windowEnd} (${dayCount} days) — ${write ? 'WRITE' : 'PREVIEW'}`);

  const dest = await loadDestination(pgFetch, slug);
  const destinationId = dest.id;
  const ianaTimezone = dest.iana_timezone;

  const rowFilter: Array<[string, string]> = [
    ['destination_id', `eq.${destinationId}`],
    ['window_start', `eq.${windowStart}`],
    ['window_end', `eq.${windowEnd}`],
  ];
  const existing = (await pgFetch(`/weather_window_stats?${qs([['select', 'destination_id'], ...rowFilter])}`)) as unknown[];
  if (existing.length !== 1) {
    if (write) throw new Error(`expected exactly one existing row, found ${existing.length}`);
    console.log(`[4e] preview: row not written yet (found ${existing.length}) — computing anyway`);
  }

  // Headline years: same probe as 4a/4b/4c (years with data at the window start, most recent N).
  const probe = (await pgFetch(
    `/weather_snapshots?${qs([
      ['select', 'observed_year,observed_date'],
      ['destination_id', `eq.${destinationId}`],
      ['observed_hour', 'eq.12'],
    ])}`,
  )) as Array<{ observed_year: number; observed_date: string }>;
  const allYears = Array.from(
    new Set(probe.filter(r => monthDay(r.observed_date) === windowMonthDays[0]).map(r => r.observed_year)),
  ).sort((a, b) => a - b);
  const headlineYears = allYears.slice(-WEATHER_THRESHOLDS.stripYearSpan).slice(-WEATHER_THRESHOLDS.headlineYearSpan);
  if (headlineYears.length < WEATHER_THRESHOLDS.headlineYearSpan) {
    throw new Error(`only ${headlineYears.length} headline year(s) with data — expected ${WEATHER_THRESHOLDS.headlineYearSpan}`);
  }
  console.log(`[4e] headline years ${headlineYears[0]}..${headlineYears.at(-1)} (${headlineYears.length})`);

  // ── Feels-like medians by part of day ────────────────────────────────────
  const morning: number[] = [];
  const afternoon: number[] = [];
  const evening: number[] = [];
  for (const y of headlineYears) {
    const range: Array<[string, string]> = [
      ['observed_date', `gte.${withYear(windowMonthDays[0], y)}`],
      ['observed_date', `lte.${withYear(windowMonthDays[dayCount - 1], y)}`],
    ];
    const snaps = (await pgFetch(
      `/weather_snapshots?${qs([
        ['select', 'observed_date,observed_hour,apparent_temperature_c,is_daylight'],
        ['destination_id', `eq.${destinationId}`],
        ...range,
        ['order', 'observed_date,observed_hour'],
      ])}`,
    )) as Snap[];
    if (snaps.length >= 1000) throw new Error(`year ${y}: ${snaps.length} rows hits PostgREST's row cap — paginate`);
    if (snaps.length !== dayCount * 24) throw new Error(`year ${y}: ${snaps.length} hourly rows, expected ${dayCount * 24}`);
    const daily = (await pgFetch(
      `/weather_daily_context?${qs([
        ['select', 'observed_date,sunset_local'],
        ['destination_id', `eq.${destinationId}`],
        ...range,
      ])}`,
    )) as Daily[];
    const sunsetByDate = new Map(daily.map(d => [d.observed_date, hhmmToMin(d.sunset_local)]));
    for (const r of snaps) {
      if (r.apparent_temperature_c === null) continue;
      const t = Number(r.apparent_temperature_c);
      const h = r.observed_hour;
      if (r.is_daylight && h < MORNING_END_H) morning.push(t);
      else if (r.is_daylight && h < AFTERNOON_END_H) afternoon.push(t);
      const sunset = sunsetByDate.get(r.observed_date);
      if (sunset === undefined) continue;
      const eveningEnd = Math.min(sunset + EVENING_AFTER_SUNSET_H * 60, EVENING_CAP_H * 60);
      if (h >= AFTERNOON_END_H && h * 60 < eveningEnd) evening.push(t);
    }
  }
  console.log(`[4e] feels-like hours: morning ${morning.length}, afternoon ${afternoon.length}, evening ${evening.length}`);

  // ── Sunsets, target year ─────────────────────────────────────────────────
  const midDate = addDays(windowStart, Math.floor((dayCount - 1) / 2));
  const sunsetMid = await estimateSunset(pgFetch, destinationId, headlineYears, ianaTimezone, midDate);
  const change = findClockChange(windowStart, windowEnd, ianaTimezone);
  const sunsetBefore = change ? await estimateSunset(pgFetch, destinationId, headlineYears, ianaTimezone, addDays(change.date, -1)) : null;
  const sunsetAfter = change ? await estimateSunset(pgFetch, destinationId, headlineYears, ianaTimezone, change.date) : null;

  const patch = {
    morning_feelslike_c: median(morning),
    afternoon_feelslike_c: median(afternoon),
    evening_feelslike_c: median(evening),
    sunset_mid_window: sunsetMid,
    // Explicit NULLs when there is no change, so stale values can never survive a re-run.
    clock_change_date: change?.date ?? null,
    sunset_before_change: sunsetBefore,
    sunset_after_change: sunsetAfter,
    computed_at: new Date().toISOString(),
  };
  console.log(`[4e] mid-window day ${midDate}; clock change ${change ? `${change.date} (${change.direction})` : 'none'}`);
  console.log(`[4e] JSON ${JSON.stringify({ slug, window_start: windowStart, window_end: windowEnd, ...patch })}`);

  if (!write) {
    console.log('[4e] preview — nothing written.');
    return;
  }
  const out = (await pgFetch(`/weather_window_stats?${qs(rowFilter)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  })) as Array<Record<string, unknown>>;
  if (out.length !== 1) throw new Error(`expected to update exactly 1 row, updated ${out.length}`);
  console.log('[4e] written.');
}

main().catch(err => {
  console.error('[4e] fatal:', err);
  process.exit(1);
});
