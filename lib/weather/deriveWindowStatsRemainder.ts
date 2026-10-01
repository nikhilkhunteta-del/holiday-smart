/**
 * Task 4b: fills the weather_window_stats columns Task 4a
 * (backfillWindowDerivation.ts) left NULL, for the SAME (destination_id,
 * window_start, window_end) row — a PATCH on the PK sending only the columns
 * computed here, so 4a's strip/headline columns are untouched and no second
 * row can be created (see the PATCH-vs-upsert comment at the write).
 *
 * Computed here:
 *   hourly_rain_share            jsonb  {"<hour>": share} over meaningful-rain
 *                                       daylight hours, all strip years (20)
 *   pct_daylight_rain_after_2pm  numeric  same data, hour >= 14 vs < 14
 *   daytime_feelslike_low/high_c   P10/P90 apparent temp, sunrise..18:00, headline years (10)
 *   evening_feelslike_low/high_c   P10/P90 apparent temp, 18:00..min(sunset+2h, 22:00), headline years
 *   sea_temp_c                   mean sea_surface_temp_c over the window, headline years
 *                                (only years that HAVE a value)
 *   sea_temp_years_used / sea_temp_years   how many, and which, headline years that mean rests on
 *                                ("2023-2025"); both NULL when there is no sea data
 *   daylight_hours_minutes       "Xh Ym", middle day of the window
 *   sunset_shift_note            only written when a ~1h day-to-day sunset jump is
 *                                found inside the window; otherwise left untouched (NULL)
 *
 * Not computed here: severe_rain_warning_years (Task 4c, deriveSevereRainWarning.ts).
 *
 * Same transport as 4a: raw PostgREST, credentials injected by the agent
 * proxy. Run with:  NODE_USE_ENV_PROXY=1 npx tsx lib/weather/deriveWindowStatsRemainder.ts
 */

import { addDays } from '../flights/snapshotJob';
import { WEATHER_THRESHOLDS } from './thresholds';
import { findClockChange, parseUtcIso, toLocalParts, utcOffsetMinutes, formatHHMM } from './localTime';

const SUPABASE_REST = 'https://mlqkicbifcwjvfagtdbc.supabase.co/rest/v1';

const DESTINATION_SLUG = 'barcelona';
const WINDOW_START = '2026-10-19';
const WINDOW_END = '2026-10-30';

/** Evening period ends at the earlier of sunset + this many hours, or the cap. */
const EVENING_AFTER_SUNSET_H = 2;
const EVENING_CAP_H = 22;
const DAY_EVENING_SPLIT_H = 18;
const AFTERNOON_SPLIT_H = 14;
/** Destination IANA zone for the clock-change check (matches destinations.iana_timezone). */
const IANA_TIMEZONE = 'Europe/Madrid';

type Snap = {
  observed_date: string;
  observed_hour: number;
  precipitation_mm: number | string;
  apparent_temperature_c: number | string | null;
  is_daylight: boolean;
};
type Daily = { observed_date: string; sunrise_local: string; sunset_local: string; sea_surface_temp_c: number | string | null };

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
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** [2019, 2022, 2023, 2024] -> "2019, 2022-2024" (consecutive runs collapsed). */
function formatYears(years: number[]): string {
  const s = [...years].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    parts.push(j > i ? `${s[i]}-${s[j]}` : `${s[i]}`);
    i = j + 1;
  }
  return parts.join(', ');
}

/** Linear-interpolation percentile (same as Postgres PERCENTILE_CONT), p in [0,1]. */
function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

async function main() {
  const dayCount = Math.round((Date.parse(WINDOW_END) - Date.parse(WINDOW_START)) / 86_400_000) + 1;
  const windowMonthDays = Array.from({ length: dayCount }, (_, d) => monthDay(addDays(WINDOW_START, d)));
  console.log(`[4b] ${DESTINATION_SLUG} ${WINDOW_START}..${WINDOW_END} (${dayCount} days)`);

  const dest = (await pgFetch(`/destinations?${qs([['select', 'id'], ['slug', `eq.${DESTINATION_SLUG}`]])}`)) as Array<{ id: string }>;
  if (dest.length === 0) throw new Error(`no destination '${DESTINATION_SLUG}'`);
  const destinationId = dest[0].id;

  // The 4a row must already exist — this task fills it in, it does not originate it.
  const existing = (await pgFetch(
    `/weather_window_stats?${qs([
      ['select', 'destination_id'],
      ['destination_id', `eq.${destinationId}`],
      ['window_start', `eq.${WINDOW_START}`],
      ['window_end', `eq.${WINDOW_END}`],
    ])}`,
  )) as unknown[];
  if (existing.length !== 1) throw new Error(`expected exactly one Task 4a row, found ${existing.length}`);

  // Years with data at the window start (same probe as 4a), then per-year fetches
  // (a year is 12 days x 24h = 288 rows, well under PostgREST's 1000-row cap).
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
  const stripYears = allYears.slice(-WEATHER_THRESHOLDS.stripYearSpan);
  const headlineYears = stripYears.slice(-WEATHER_THRESHOLDS.headlineYearSpan);
  console.log(`[4b] strip years ${stripYears[0]}..${stripYears.at(-1)} (${stripYears.length}); headline years ${headlineYears[0]}..${headlineYears.at(-1)} (${headlineYears.length})`);

  const snapsByYear = new Map<number, Snap[]>();
  const dailyByYear = new Map<number, Daily[]>();
  for (const y of stripYears) {
    const lo = withYear(windowMonthDays[0], y);
    const hi = withYear(windowMonthDays[dayCount - 1], y);
    const range: Array<[string, string]> = [['observed_date', `gte.${lo}`], ['observed_date', `lte.${hi}`]];
    snapsByYear.set(y, (await pgFetch(
      `/weather_snapshots?${qs([
        ['select', 'observed_date,observed_hour,precipitation_mm,apparent_temperature_c,is_daylight'],
        ['destination_id', `eq.${destinationId}`],
        ...range,
        ['order', 'observed_date,observed_hour'],
      ])}`,
    )) as Snap[]);
    dailyByYear.set(y, (await pgFetch(
      `/weather_daily_context?${qs([
        ['select', 'observed_date,sunrise_local,sunset_local,sea_surface_temp_c'],
        ['destination_id', `eq.${destinationId}`],
        ...range,
        ['order', 'observed_date'],
      ])}`,
    )) as Daily[]);
  }

  // ── 1 + 2. Rain share by hour (all strip years), before/after 14:00 ──────
  const rainByHour = new Map<number, number>(); // hour -> meaningful-rain hour count
  const daylightHoursSeen = new Set<number>();
  let totalRainHours = 0;
  let afterTwoRainHours = 0;
  for (const y of stripYears) {
    for (const r of snapsByYear.get(y)!) {
      if (!r.is_daylight) continue;
      daylightHoursSeen.add(r.observed_hour);
      if (Number(r.precipitation_mm) >= WEATHER_THRESHOLDS.meaningfulRainHourMm) {
        rainByHour.set(r.observed_hour, (rainByHour.get(r.observed_hour) ?? 0) + 1);
        totalRainHours++;
        if (r.observed_hour >= AFTERNOON_SPLIT_H) afterTwoRainHours++;
      }
    }
  }
  if (totalRainHours === 0) throw new Error('no meaningful-rain daylight hours found — share is undefined');
  const hourlyRainShare: Record<string, number> = {};
  for (const h of [...daylightHoursSeen].sort((a, b) => a - b)) {
    hourlyRainShare[String(h)] = Math.round(((rainByHour.get(h) ?? 0) / totalRainHours) * 10000) / 10000;
  }
  const pctAfter2pm = round1((afterTwoRainHours / totalRainHours) * 100);
  console.log(`[4b] meaningful-rain daylight hours: ${totalRainHours} (after 14:00: ${afterTwoRainHours})`);

  // ── 3 + 4. Feels-like percentiles, headline years ────────────────────────
  const dayTemps: number[] = [];
  const eveTemps: number[] = [];
  for (const y of headlineYears) {
    const sunsetByDate = new Map(dailyByYear.get(y)!.map(d => [d.observed_date, hhmmToMin(d.sunset_local)]));
    for (const r of snapsByYear.get(y)!) {
      if (r.apparent_temperature_c === null) continue;
      const t = Number(r.apparent_temperature_c);
      const h = r.observed_hour;
      if (r.is_daylight && h < DAY_EVENING_SPLIT_H) dayTemps.push(t); // sunrise..18:00
      const sunset = sunsetByDate.get(r.observed_date);
      if (sunset === undefined) continue;
      const eveningEnd = Math.min(sunset + EVENING_AFTER_SUNSET_H * 60, EVENING_CAP_H * 60);
      if (h * 60 >= DAY_EVENING_SPLIT_H * 60 && h * 60 < eveningEnd) eveTemps.push(t);
    }
  }
  const p = (v: number[], q: number) => round1(percentile(v, q));

  // ── 5. Sea temp, headline years, only years/days that have a value ───────
  const seaVals: number[] = [];
  const seaYears = new Set<number>();
  for (const y of headlineYears) {
    for (const d of dailyByYear.get(y)!) {
      if (d.sea_surface_temp_c !== null) { seaVals.push(Number(d.sea_surface_temp_c)); seaYears.add(y); }
    }
  }
  // No values at all (e.g. andalusian-corridor, an inland destination with no sea data) is expected,
  // not an error: sea_temp_c is written as an explicit NULL, never a placeholder.
  const seaTemp = seaVals.length === 0 ? null : round1(seaVals.reduce((a, b) => a + b, 0) / seaVals.length);
  console.log(`[4b] sea temp: ${seaVals.length} day-values across ${seaYears.size} of ${headlineYears.length} headline years (${[...seaYears].join(', ')}) -> ${seaTemp ?? 'NULL (no data)'}`);

  // ── 6. Daylight length, middle day of the window ─────────────────────────
  // Window has an even day count, so "middle" = offset floor((n-1)/2). Averaged over the
  // headline years for that month/day (duration is DST-invariant, clock times are not).
  const midOffset = Math.floor((dayCount - 1) / 2);
  const midMd = windowMonthDays[midOffset];
  const durations = headlineYears.flatMap(y => {
    const d = dailyByYear.get(y)!.find(x => monthDay(x.observed_date) === midMd);
    return d ? [hhmmToMin(d.sunset_local) - hhmmToMin(d.sunrise_local)] : [];
  });
  const meanMin = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
  const daylightHoursMinutes = `${Math.floor(meanMin / 60)}h ${meanMin % 60}m`;
  console.log(`[4b] daylight on ${midMd} (offset ${midOffset}), mean of ${durations.length} headline years: ${daylightHoursMinutes}`);

  // ── 7. sunset_shift_note — the window's OWN target year, never a historical loop year ──
  // Does a clock change fall inside [WINDOW_START, WINDOW_END] in the target year (the year of
  // WINDOW_START)? Answered from the IANA zone for those exact dates. No weather data exists yet
  // for a future year, so the two sunset times are estimated as the mean over the headline years
  // of the real observed sunset on the SAME calendar dates (day before / day of the change),
  // expressed as UTC instants, then shown on the target year's own wall clock. Sunset on a fixed
  // calendar date moves by at most a couple of minutes between years, hence "about".
  const targetYear = Number(WINDOW_START.slice(0, 4));
  const change = findClockChange(WINDOW_START, WINDOW_END, IANA_TIMEZONE);
  let sunsetShiftNote: string | null = null;
  if (change) {
    const prevDate = addDays(change.date, -1);
    const sunsetUtcMinutes = async (target: string): Promise<number> => {
      const md = monthDay(target);
      const mins: number[] = [];
      for (const y of headlineYears) {
        const row = (await pgFetch(
          `/weather_daily_context?${qs([
            ['select', 'sunset_local'],
            ['destination_id', `eq.${destinationId}`],
            ['observed_date', `eq.${withYear(md, y)}`],
          ])}`,
        )) as Array<{ sunset_local: string }>;
        if (row.length !== 1) throw new Error(`no sunset for ${withYear(md, y)} — cannot estimate ${target}`);
        // Stored sunset_local is wall-clock in THAT year; convert back to a UTC time-of-day.
        const [yy, mm, dd] = withYear(md, y).split('-').map(Number);
        const [hh, mi] = row[0].sunset_local.split(':').map(Number);
        let utc = Date.UTC(yy, mm - 1, dd, hh, mi);
        utc -= utcOffsetMinutes(utc, IANA_TIMEZONE) * 60_000; // approximate, then refine once
        utc = Date.UTC(yy, mm - 1, dd, hh, mi) - utcOffsetMinutes(utc, IANA_TIMEZONE) * 60_000;
        mins.push((utc % 86_400_000) / 60_000);
      }
      return mins.reduce((a, b) => a + b, 0) / mins.length;
    };
    const toTargetClock = (target: string, utcMinuteOfDay: number): string => {
      const instant = Date.parse(`${target}T00:00:00Z`) + Math.round(utcMinuteOfDay) * 60_000;
      return formatHHMM(toLocalParts(instant, IANA_TIMEZONE));
    };
    const before = toTargetClock(prevDate, await sunsetUtcMinutes(prevDate));
    const after = toTargetClock(change.date, await sunsetUtcMinutes(change.date));
    const dayLabel = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
      .formatToParts(new Date(`${change.date}T12:00:00Z`));
    const part = (t: string) => dayLabel.find(p => p.type === t)!.value;
    const when = `${part('weekday')} ${part('day')} ${part('month')}`;
    sunsetShiftNote = `Clocks go ${change.direction === 'back' ? 'back' : 'forward'} on ${when} — sunset moves from about ${before} to about ${after}.`;
    console.log(`[4b] ${targetYear} clock change in window: ${change.date} (${change.direction}); sunset est. ${prevDate} ${before} -> ${change.date} ${after}`);
  } else {
    console.log(`[4b] no ${IANA_TIMEZONE} clock change inside ${WINDOW_START}..${WINDOW_END} in ${targetYear} — sunset_shift_note = NULL`);
  }

  // ── Upsert: PK + only the columns computed here ──────────────────────────
  const body: Record<string, unknown> = {
    destination_id: destinationId,
    window_start: WINDOW_START,
    window_end: WINDOW_END,
    hourly_rain_share: hourlyRainShare,
    pct_daylight_rain_after_2pm: pctAfter2pm,
    daytime_feelslike_low_c: p(dayTemps, 0.1),
    daytime_feelslike_high_c: p(dayTemps, 0.9),
    evening_feelslike_low_c: p(eveTemps, 0.1),
    evening_feelslike_high_c: p(eveTemps, 0.9),
    sea_temp_c: seaTemp,
    // Explicit NULLs when there is no sea data, so stale values can never survive a re-run.
    sea_temp_years_used: seaYears.size === 0 ? null : seaYears.size,
    sea_temp_years: seaYears.size === 0 ? null : formatYears([...seaYears]),
    daylight_hours_minutes: daylightHoursMinutes,
  };
  // Always sent (string or explicit null) so a note from an earlier run can never go stale.
  body.sunset_shift_note = sunsetShiftNote;
  console.log(`[4b] feels-like samples: daytime ${dayTemps.length}, evening ${eveTemps.length}`);

  // PATCH on the PK, not POST/upsert: an upsert's INSERT half is NOT-NULL-checked before
  // conflict resolution, so omitting Task 4a's columns would fail. The row is verified
  // to exist above, so a PATCH updates exactly it and can never create a second row.
  const { destination_id: _d, window_start: _s, window_end: _e, ...patch } = body;
  const out = (await pgFetch(
    `/weather_window_stats?${qs([
      ['destination_id', `eq.${destinationId}`],
      ['window_start', `eq.${WINDOW_START}`],
      ['window_end', `eq.${WINDOW_END}`],
    ])}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    },
  )) as Array<Record<string, unknown>>;
  if (out.length !== 1) throw new Error(`expected to update exactly 1 row, updated ${out.length}`);

  console.log('\n[4b] weather_window_stats row:');
  console.log(JSON.stringify(out[0], null, 2));
  console.log('\n[4b] hourly_rain_share (raw jsonb):');
  console.log(JSON.stringify(out[0].hourly_rain_share, null, 2));

  const count = (await pgFetch(
    `/weather_window_stats?${qs([['select', 'destination_id'], ['destination_id', `eq.${destinationId}`]])}`,
  )) as unknown[];
  console.log(`\n[4b] weather_window_stats rows for ${DESTINATION_SLUG}: ${count.length}`);
}

main().catch(err => {
  console.error('[4b] fatal:', err);
  process.exit(1);
});
