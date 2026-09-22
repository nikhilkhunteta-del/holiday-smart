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
 * WINDOW_START/WINDOW_END, and every loop below runs over
 * [0, dayCount) rather than assuming a week. This run's actual window
 * (Barcelona, 2026-10-19..2026-10-30) is 12 days inclusive.
 *
 * Thresholds come only from WEATHER_THRESHOLDS (lib/weather/thresholds.ts)
 * — nothing here hardcodes a rain/washout number.
 *
 * weather_window_stats has several NOT NULL columns this task does not
 * compute (feels-like ranges, sea_temp_c, daylight_hours_minutes,
 * hourly_rain_share, pct_daylight_rain_after_2pm, severe_rain_warning_years
 * — a different derivation task's job). So this script only ever UPDATEs
 * an existing weather_window_stats row's strip/headline columns; if no row
 * exists yet for this destination/window it stops and reports that,
 * rather than inventing placeholder values for columns nobody asked it to
 * compute.
 *
 * Usage:
 *   npx ts-node --project tsconfig.json lib/weather/backfillWindowDerivation.ts
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { addDays } from '../flights/snapshotJob';
import { WEATHER_THRESHOLDS } from './thresholds';

// ── Config for this run ──────────────────────────────────────────────────────

const DESTINATION_SLUG = 'barcelona';
const WINDOW_START = '2026-10-19';
const WINDOW_END = '2026-10-30';

type CellState = 'dry' | 'some_rain' | 'washout';

// ── Supabase client (same env-var contract as weatherSnapshotJob.ts) ────────

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

// ── Date helpers ──────────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' -> 'MM-DD'. */
function monthDay(dateStr: string): string {
  return dateStr.slice(5);
}

/** Same month/day as dateStr, in a different year. Not leap-day-safe, but
 *  the Oct 19-30 window this run uses never crosses Feb 29. */
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
  const supabase = getSupabase();

  const dayCount = dayCountInclusive(WINDOW_START, WINDOW_END);
  const offsetMonthDays = Array.from({ length: dayCount }, (_, d) => monthDay(addDays(WINDOW_START, d)));

  console.log(
    `[backfill] ${DESTINATION_SLUG} window ${WINDOW_START}..${WINDOW_END} — ${dayCount} days inclusive`,
  );

  // ── 1. Destination lookup ────────────────────────────────────────────────

  const { data: destRow, error: destErr } = await supabase
    .from('destinations')
    .select('id')
    .eq('slug', DESTINATION_SLUG)
    .single();

  if (destErr || !destRow) {
    throw new Error(`destinations lookup failed for '${DESTINATION_SLUG}': ${destErr?.message ?? 'not found'}`);
  }
  const destinationId = destRow.id as string;

  // ── 2. Which years actually have data ────────────────────────────────────

  const { data: yearRows, error: yearErr } = await supabase
    .from('weather_snapshots')
    .select('observed_year')
    .eq('destination_id', destinationId);

  if (yearErr) throw new Error(`weather_snapshots year scan failed: ${yearErr.message}`);

  const allYears = Array.from(new Set((yearRows ?? []).map(r => r.observed_year as number))).sort(
    (a, b) => a - b,
  );

  if (allYears.length === 0) {
    throw new Error(`No weather_snapshots rows at all for '${DESTINATION_SLUG}' — nothing to derive.`);
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

    const { data: rows, error } = await supabase
      .from('weather_snapshots')
      .select('observed_date, precipitation_mm')
      .eq('destination_id', destinationId)
      .eq('is_daylight', true)
      .gte('observed_date', yearWindowStart)
      .lte('observed_date', yearWindowEnd);

    if (error) throw new Error(`weather_snapshots fetch failed for year ${year}: ${error.message}`);

    // Group daylight precip rows by date.
    const byDate = new Map<string, number[]>();
    for (const r of rows ?? []) {
      const date = r.observed_date as string;
      const mm = Number(r.precipitation_mm);
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date)!.push(mm);
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
        window_start: WINDOW_START,
        window_end: WINDOW_END,
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

  const { error: insertErr } = await supabase
    .from('weather_strip_cells')
    .upsert(strippedCellRows, {
      onConflict: 'destination_id,window_start,window_end,strip_year,day_offset',
    });

  if (insertErr) throw new Error(`weather_strip_cells upsert failed: ${insertErr.message}`);
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

  // ── 8. weather_window_stats: UPDATE only, never a blind INSERT ──────────
  // (see file header — several NOT NULL columns are out of scope here)

  const { data: existing, error: existingErr } = await supabase
    .from('weather_window_stats')
    .select('*')
    .eq('destination_id', destinationId)
    .eq('window_start', WINDOW_START)
    .eq('window_end', WINDOW_END)
    .maybeSingle();

  if (existingErr) throw new Error(`weather_window_stats lookup failed: ${existingErr.message}`);

  if (!existing) {
    console.error(
      '[backfill] STOPPED before writing weather_window_stats: no existing row for ' +
      `(${DESTINATION_SLUG}, ${WINDOW_START}, ${WINDOW_END}). This script only updates the ` +
      'strip/headline columns of an existing row — inserting a fresh row would require values ' +
      'for pct_daylight_rain_after_2pm, hourly_rain_share, daytime/evening feels-like ranges, ' +
      'sea_temp_c, daylight_hours_minutes and severe_rain_warning_years, none of which this task ' +
      'computes. weather_strip_cells was written successfully above; resolve the missing row ' +
      '(either seed it via whatever job computes those other fields, or confirm placeholder values) ' +
      'before re-running this step.',
    );
    printStripPrintout(stripYears, cellStateByYear);
    process.exitCode = 1;
    return;
  }

  const { data: updated, error: updateErr } = await supabase
    .from('weather_window_stats')
    .update(windowStatsPatch)
    .eq('destination_id', destinationId)
    .eq('window_start', WINDOW_START)
    .eq('window_end', WINDOW_END)
    .select('*')
    .single();

  if (updateErr) throw new Error(`weather_window_stats update failed: ${updateErr.message}`);

  console.log('\n[backfill] weather_window_stats row:');
  console.log(JSON.stringify(updated, null, 2));

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
