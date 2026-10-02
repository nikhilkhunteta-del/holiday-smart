/**
 * One-off Layer 3 derivation: weather_strip_cells + the strip-related /
 * headline fields of weather_window_stats, for one destination x window.
 *
 * This is the derivation step weatherSnapshotJob.ts's own header calls out
 * as separate ("that derivation is a separate task") — it reads the raw,
 * borough-blind weather_snapshots rows that job already populated and
 * slices them down to one specific school-window's actual calendar dates,
 * per historical year.
 *
 * Deliberately NOT hardcoded to a 7-day window: dayCount is derived from
 * windowStart/windowEnd, and every loop below runs over
 * [0, dayCount) rather than assuming a week. The destination slug and
 * window are command-line inputs (see Usage below); e.g. the October 2026
 * half-term window 2026-10-19..2026-10-30 is 12 days inclusive.
 *
 * Thresholds come only from WEATHER_THRESHOLDS (lib/weather/thresholds.ts)
 * — nothing here hardcodes a rain/washout number.
 *
 * weather_window_stats has several columns this task does not
 * compute (feels-like ranges, sea_temp_c, daylight_hours_minutes,
 * hourly_rain_share, pct_daylight_rain_after_2pm, severe_rain_warning_years
 * — a different derivation task's job). So this script UPSERTs a
 * weather_window_stats row (on the PK) containing only the strip/headline
 * columns; the others are omitted and stay NULL, never placeholder values.
 * That relies on those columns being nullable — see the DROP NOT NULL
 * migration at the bottom of supabase/tables/weather_window_stats.sql.
 *
 * ── Transport: raw PostgREST calls, deliberately NOT @supabase/supabase-js ──
 * This process never holds the Supabase service-role key. Per this
 * environment's "API credential" mechanism (code.claude.com/docs/en/
 * cloud-environments#add-api-credentials), a key added to the cloud
 * environment is attached by Anthropic's agent proxy to matching outbound
 * requests AFTER they leave this VM — it never reaches process.env, so
 * supabase-js's createClient(url, key), which requires the literal key
 * string to build its own request headers, cannot be used here. Instead,
 * pgFetch() below sends plain, unauthenticated-looking requests to the
 * PostgREST REST endpoint; the environment's API credential(s) for this
 * host are expected to inject BOTH headers PostgREST needs:
 *   - `apikey`                    (bare value, no prefix)
 *   - `Authorization: Bearer ...` (this is what sets the effective Postgres
 *                                   role — without it, requests run as
 *                                   `anon`, not `service_role`, regardless
 *                                   of `apikey`)
 * If either is missing from the environment's credential config, every
 * call below fails with 401 — see pgFetch()'s error message.
 *
 * Usage (destination slug and window are inputs — see derivationInputs.ts):
 *   NODE_USE_ENV_PROXY=1 npx tsx lib/weather/backfillWindowDerivation.ts \
 *     --slug=barcelona --window-start=2026-10-19 --window-end=2026-10-30
 */

import { addDays } from '../flights/snapshotJob';
import { WEATHER_THRESHOLDS } from './thresholds';
import { parseDerivationArgs, loadDestination } from './derivationInputs';

// ── Config for this run ──────────────────────────────────────────────────────

// Not a secret — a Supabase project ref only identifies which project to
// call, it grants no access on its own. The service-role key that DOES
// grant access is never read by this script (see file header).
const SUPABASE_URL = 'https://mlqkicbifcwjvfagtdbc.supabase.co';
const SUPABASE_REST = `${SUPABASE_URL}/rest/v1`;


/** Representative hour used to test "does this year have data at all" —
 *  same defensive-single-sample reasoning as SEA_TEMP_REPRESENTATIVE_HOUR
 *  in weatherSnapshotJob.ts, not a full-year scan (which would be a much
 *  larger, paginated fetch for no extra certainty). */
const YEAR_PROBE_HOUR = 12;

type CellState = 'dry' | 'some_rain' | 'washout';

// ── Raw PostgREST helper ─────────────────────────────────────────────────────

/** Builds a query string from possibly-repeated key/value pairs (PostgREST
 *  needs e.g. two `observed_date` filters — gte AND lte — in one request,
 *  which a plain object can't represent). */
function qs(pairs: Array<[string, string]>): string {
  return new URLSearchParams(pairs).toString();
}

async function pgFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${SUPABASE_REST}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const bodyText = await res.text();
  if (!res.ok) {
    const hint =
      res.status === 401
        ? '\nThis usually means the environment\'s API credential for this host is missing the ' +
          '`apikey` and/or `Authorization: Bearer` header (see file header) — this script never ' +
          'sets them itself.'
        : '';
    throw new Error(`PostgREST ${init.method ?? 'GET'} ${path} -> ${res.status}: ${bodyText}${hint}`);
  }
  return bodyText ? JSON.parse(bodyText) : null;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' -> 'MM-DD'. */
function monthDay(dateStr: string): string {
  return dateStr.slice(5);
}

/** Same month/day as dateStr, in a different year. Not leap-day-safe, but
 *  an October half-term window never crosses Feb 29. */
function withYear(monthDayStr: string, year: number): string {
  return `${year}-${monthDayStr}`;
}

function dayCountInclusive(startStr: string, endStr: string): number {
  const start = new Date(startStr + 'T00:00:00Z').getTime();
  const end = new Date(endStr + 'T00:00:00Z').getTime();
  return Math.round((end - start) / 86_400_000) + 1;
}

// ── Stats helpers ─────────────────────────────────────────────────────────────

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  const m = n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(m * 10) / 10; // numeric(3,1)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { slug, windowStart, windowEnd } = parseDerivationArgs();
  const dayCount = dayCountInclusive(windowStart, windowEnd);
  const offsetMonthDays = Array.from({ length: dayCount }, (_, d) => monthDay(addDays(windowStart, d)));

  console.log(
    `[backfill] ${slug} window ${windowStart}..${windowEnd} — ${dayCount} days inclusive`,
  );

  // ── 1. Destination lookup ────────────────────────────────────────────────

  const destinationId = (await loadDestination(pgFetch, slug)).id;

  // ── 2. Which years actually have data ────────────────────────────────────
  // Probe one representative hour per day (rather than fetching every hourly
  // row) — the raw weather_snapshots fetch job already stores a narrow
  // per-year calendar range (Oct15-Nov5-ish, not the whole year), so this
  // stays small without needing a date filter. Filtered client-side to the
  // window-start day/month, since `like` isn't usable against a native
  // `date` column (Postgres has no ~~ operator for `date`, only `text`).
  const probeRows = (await pgFetch(
    `/weather_snapshots?${qs([
      ['select', 'observed_year,observed_date'],
      ['destination_id', `eq.${destinationId}`],
      ['observed_hour', `eq.${YEAR_PROBE_HOUR}`],
    ])}`,
  )) as Array<{ observed_year: number; observed_date: string }>;

  const allYears = Array.from(
    new Set(
      probeRows.filter(r => monthDay(r.observed_date) === offsetMonthDays[0]).map(r => r.observed_year),
    ),
  ).sort((a, b) => a - b);

  if (allYears.length === 0) {
    throw new Error(`No weather_snapshots rows found for '${slug}' at this window — nothing to derive.`);
  }

  // Most recent stripYearSpan years (or fewer, with a loud warning — never
  // silently claim WEATHER_THRESHOLDS.stripYearSpan years were used when
  // fewer were actually found).
  const stripYears = allYears.slice(-WEATHER_THRESHOLDS.stripYearSpan);
  if (stripYears.length < WEATHER_THRESHOLDS.stripYearSpan) {
    console.warn(
      `[backfill] WARNING: only ${stripYears.length} year(s) of data found ` +
      `(expected stripYearSpan=${WEATHER_THRESHOLDS.stripYearSpan}). Proceeding with what's available.`,
    );
  }
  console.log(`[backfill] strip years: ${stripYears.join(', ')}`);

  // ── 3. Per year, per day: fetch daylight hours, classify ────────────────

  // cellStateByYear[year] = CellState[dayCount], in day_offset order
  const cellStateByYear = new Map<number, CellState[]>();
  const strippedCellRows: Array<{
    destination_id: string;
    window_start: string;
    window_end: string;
    strip_year: number;
    day_offset: number;
    cell_state: CellState;
  }> = [];

  const missingDataDates: string[] = [];

  for (const year of stripYears) {
    const yearWindowStart = withYear(offsetMonthDays[0], year);
    const yearWindowEnd = withYear(offsetMonthDays[dayCount - 1], year);

    const rows = (await pgFetch(
      `/weather_snapshots?${qs([
        ['select', 'observed_date,precipitation_mm'],
        ['destination_id', `eq.${destinationId}`],
        ['is_daylight', 'eq.true'],
        ['observed_date', `gte.${yearWindowStart}`],
        ['observed_date', `lte.${yearWindowEnd}`],
      ])}`,
    )) as Array<{ observed_date: string; precipitation_mm: number | string }>;

    // Group daylight precip rows by date.
    const byDate = new Map<string, number[]>();
    for (const r of rows) {
      const mm = Number(r.precipitation_mm);
      if (!byDate.has(r.observed_date)) byDate.set(r.observed_date, []);
      byDate.get(r.observed_date)!.push(mm);
    }

    const cellStates: CellState[] = [];
    for (let d = 0; d < dayCount; d++) {
      const date = withYear(offsetMonthDays[d], year);
      const precipValues = byDate.get(date) ?? [];
      if (precipValues.length === 0) missingDataDates.push(`${date} (year ${year})`);

      const rainHours = precipValues.filter(mm => mm >= WEATHER_THRESHOLDS.meaningfulRainHourMm).length;
      const totalDaylightMm = precipValues.reduce((sum, mm) => sum + mm, 0);

      let state: CellState;
      if (
        rainHours >= WEATHER_THRESHOLDS.washoutDayRainHours ||
        totalDaylightMm >= WEATHER_THRESHOLDS.washoutDayTotalMm
      ) {
        state = 'washout';
      } else if (rainHours >= 1) {
        state = 'some_rain';
      } else {
        state = 'dry';
      }

      cellStates.push(state);
      strippedCellRows.push({
        destination_id: destinationId,
        window_start: windowStart,
        window_end: windowEnd,
        strip_year: year,
        day_offset: d,
        cell_state: state,
      });
    }
    cellStateByYear.set(year, cellStates);
  }

  if (missingDataDates.length > 0) {
    console.warn(
      `[backfill] WARNING: ${missingDataDates.length} window-date(s) had zero daylight rows ` +
      `(classified 'dry' by formula, not confirmed dry):\n  ${missingDataDates.join('\n  ')}`,
    );
  }

  // ── 4. Insert weather_strip_cells (upsert on PK) ─────────────────────────

  await pgFetch(
    `/weather_strip_cells?${qs([
      ['on_conflict', 'destination_id,window_start,window_end,strip_year,day_offset'],
    ])}`,
    {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(strippedCellRows),
    },
  );
  console.log(`[backfill] weather_strip_cells: upserted ${strippedCellRows.length} row(s)`);

  // ── 5. Per-year washout day counts (reused for both strip + headline) ───

  const washoutCountByYear = new Map<number, number>();
  for (const [year, states] of cellStateByYear) {
    washoutCountByYear.set(year, states.filter(s => s === 'washout').length);
  }

  // ── 6. Strip-wide stats ───────────────────────────────────────────────────

  const washoutCounts = stripYears.map(y => washoutCountByYear.get(y)!);
  const typicalWashoutDays = median(washoutCounts);
  const washoutDaysMin = Math.min(...washoutCounts);
  const washoutDaysMax = Math.max(...washoutCounts);

  // consecutive_washout_years: sequential scan per year, NOT a count of
  // washout days >= 2 — a year with 2 washout days that are NOT adjacent
  // must not count here.
  let consecutiveWashoutYears = 0;
  for (const year of stripYears) {
    const states = cellStateByYear.get(year)!;
    let hasConsecutive = false;
    for (let d = 0; d < states.length - 1; d++) {
      if (states[d] === 'washout' && states[d + 1] === 'washout') {
        hasConsecutive = true;
        break;
      }
    }
    if (hasConsecutive) consecutiveWashoutYears++;
  }

  // ── 7. Headline stats (most recent headlineYearSpan years only) ─────────

  const headlineYears = [...stripYears].sort((a, b) => b - a).slice(0, WEATHER_THRESHOLDS.headlineYearSpan);
  headlineYears.sort((a, b) => a - b); // back to ascending for readability

  if (headlineYears.length < WEATHER_THRESHOLDS.headlineYearSpan) {
    console.warn(
      `[backfill] WARNING: only ${headlineYears.length} year(s) available for the headline ` +
      `(expected headlineYearSpan=${WEATHER_THRESHOLDS.headlineYearSpan}). ` +
      `headline_total_years/headline_years_used will still read ${WEATHER_THRESHOLDS.headlineYearSpan} ` +
      `per spec, but that overstates what's actually behind them — flag before trusting the headline.`,
    );
  }

  const headlineCleanYearCount = headlineYears.filter(y => washoutCountByYear.get(y)! <= 1).length;

  const windowStatsPatch = {
    strip_years_used: stripYears.length,
    typical_washout_days: typicalWashoutDays,
    washout_days_min: washoutDaysMin,
    washout_days_max: washoutDaysMax,
    consecutive_washout_years: consecutiveWashoutYears,
    headline_years_used: WEATHER_THRESHOLDS.headlineYearSpan,
    headline_clean_year_count: headlineCleanYearCount,
    headline_total_years: WEATHER_THRESHOLDS.headlineYearSpan,
    computed_at: new Date().toISOString(),
  };

  // ── 8. weather_window_stats: upsert on PK ───────────────────────────────
  // Sends only the columns this task computes. The other NOT-NULL-originally
  // columns (feels-like ranges, sea_temp_c, etc.) are omitted, so they stay
  // NULL on insert and are left untouched on conflict — requires the DROP NOT
  // NULL migration at the bottom of supabase/tables/weather_window_stats.sql.

  const updatedRows = (await pgFetch(
    `/weather_window_stats?${qs([
      ['on_conflict', 'destination_id,window_start,window_end'],
    ])}`,
    {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        destination_id: destinationId,
        window_start: windowStart,
        window_end: windowEnd,
        ...windowStatsPatch,
      }),
    },
  )) as Array<Record<string, unknown>>;

  console.log('\n[backfill] weather_window_stats row:');
  console.log(JSON.stringify(updatedRows[0], null, 2));

  printStripPrintout(stripYears, cellStateByYear);
}

function printStripPrintout(stripYears: number[], cellStateByYear: Map<number, CellState[]>) {
  const SYMBOL: Record<CellState, string> = { dry: '.', some_rain: 'o', washout: 'W' };
  console.log('\n[backfill] strip printout (year, then day_offset 0..N-1):');
  console.log(`  legend: ${SYMBOL.dry}=dry  ${SYMBOL.some_rain}=some_rain  ${SYMBOL.washout}=washout`);
  for (const year of stripYears) {
    const states = cellStateByYear.get(year)!;
    const line = states.map(s => SYMBOL[s]).join(' ');
    console.log(`  ${year}:  ${line}`);
  }
}

main().catch(err => {
  console.error('[backfill] fatal:', err);
  process.exit(1);
});
