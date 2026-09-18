/**
 * Annual weather-history snapshot job.
 *
 * Architecture (mirrors lib/flights/snapshotJob.ts's shape deliberately):
 *   For each destination × historical year:
 *     - One Historical Weather API call (archive-api.open-meteo.com):
 *       hourly precipitation/temperature/apparent_temperature/cloud_cover/
 *       wind_speed_10m/weather_code, plus a daily sunrise/sunset block —
 *       for that year's wide calendar date range, in the destination's
 *       local timezone.
 *     - One Marine Weather API call (marine-api.open-meteo.com):
 *       hourly sea_surface_temperature, same range/timezone.
 *   Every hour returned becomes one weather_snapshots row; every day
 *   becomes one weather_daily_context row.
 *
 * BOROUGH-BLIND BY DESIGN (corrected from an earlier version that keyed
 * the raw tables on window_start/window_end): weather is
 * destination-specific, not borough-specific — only the WINDOW (which
 * calendar days count as "the holiday") varies by school/borough, via
 * inset days. This job fetches one wide calendar date range per
 * destination per year (config default: 15 Oct – 5 Nov), independent of
 * any specific school/borough's actual term window, then stores every
 * hour of that range unconditionally. This is the same principle already
 * established for fare_snapshots: raw/expensive data stays borough-blind;
 * only the derived layer (weather_window_stats/weather_strip_cells, a
 * separate task) varies by window, by reading the slice of this table
 * that falls inside whatever window a given school/borough actually has.
 * Confirmed while making this change: this file never queried
 * school_term_dates/borough_term_dates, and never took a school/URN
 * parameter, even in its previous window-scoped form — the window
 * concept lived only in the config shape (WeatherTargetWindow) and the
 * two now-removed table columns, not in any actual per-school lookup.
 *
 * This job only populates the raw Layer 2 tables (weather_snapshots,
 * weather_daily_context). It deliberately does NOT write to the derived
 * Layer 3 tables (weather_window_stats, weather_strip_cells) — that
 * derivation is a separate task, same "raw feeds derived" pattern already
 * used for cell_price_history/destination_median_history.
 *
 * Destination coordinates come from destinations.latitude/longitude
 * (added alongside iana_timezone — see supabase/tables/destinations.sql).
 * For a circuit destination (Andalusian Corridor: SVQ + AGP legs), that
 * column holds the MIDPOINT of the circuit's legs, not one leg picked
 * over another — an explicit decision confirmed with the user, not
 * assumed (see the backfill file for the specific values and the known
 * consequence this has for sea_surface_temp_c on that destination).
 *
 * Idempotency: unlike fare_snapshots (an intentionally-growing time series
 * — a re-fetched price is a new, real observation), a given historical
 * hour's weather is a fact that doesn't change between runs. Both
 * weather_snapshots and weather_daily_context have real uniqueness
 * constraints for this reason (see supabase/tables/), so this job upserts
 * on those constraints rather than plain-inserting — re-running the same
 * destination/year refreshes the row instead of failing or duplicating.
 *
 * Usage (programmatic):
 *   import { runWeatherSnapshotJob } from './weatherSnapshotJob';
 *   await runWeatherSnapshotJob({ dateRange: OCT_NOV_RANGE });
 *
 * Usage (direct, pilot):
 *   npx ts-node --project tsconfig.json lib/weather/weatherSnapshotJob.ts
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { addDays } from '../flights/snapshotJob';
import { WEATHER_THRESHOLDS } from './thresholds';

// ── Config ────────────────────────────────────────────────────────────────────

/** Destinations included in the pilot run — same 3 slugs as the flights job. */
const PILOT_SLUGS = ['barcelona', 'andalusian-corridor', 'malta'] as const;

/** Minimum delay between Open-Meteo calls (ms). Not a documented requirement —
 *  couldn't reach open-meteo.com's docs from this environment to confirm rate
 *  limits (outbound network policy blocks archive-api.open-meteo.com here),
 *  so this is a conservative courtesy delay, same defensive pattern as
 *  API_DELAY_MS in the flights job. */
const API_DELAY_MS = 500;

const ARCHIVE_HOURLY_VARS = 'precipitation,temperature_2m,apparent_temperature,cloud_cover,wind_speed_10m,weather_code';
const ARCHIVE_DAILY_VARS  = 'sunrise,sunset';
const MARINE_HOURLY_VARS  = 'sea_surface_temperature';

/** Representative hour used for weather_daily_context.sea_surface_temp_c —
 *  the Marine API returns hourly readings, but the daily-context table
 *  stores one figure per day; noon local time is a simple, defensible
 *  single sample rather than inventing a daily-mean computation nobody asked for. */
const SEA_TEMP_REPRESENTATIVE_HOUR = 12;

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface WeatherDateRange {
  /** Stored in snapshot_runs.target_windows, e.g. 'oct15-nov5' — a label for
   *  the wide calendar range being fetched. Deliberately NOT called a
   *  "window": this is a fixed calendar range fetched the same way for
   *  every destination, not a specific school/borough's term dates. */
  label: string;
  /** Wide calendar range start, YYYY-MM-DD, for a reference year — only the
   *  month/day matter, since shiftYear() maps this onto every historical
   *  year fetched. Must comfortably cover every borough's actual window
   *  (inset days included) for the derived layer to have real data to
   *  read regardless of which specific school/borough it's computing for. */
  rangeStart: string;
  /** Wide calendar range end, YYYY-MM-DD. */
  rangeEnd: string;
}

export interface WeatherJobConfig {
  dateRange: WeatherDateRange;
  /** Override pilot destination slugs. Defaults to PILOT_SLUGS. */
  destinationSlugs?: string[];
  /** How many historical years to fetch, counting back from dateRange's own
   *  reference year (exclusive — only past years, since the archive API has
   *  no data for a future booking window). Defaults to
   *  WEATHER_THRESHOLDS.stripYearSpan (20), the same figure the year-by-year
   *  strip feature is defined around. */
  yearSpan?: number;
}

export interface WeatherSnapshotJobResult {
  runId: string;
  total: number;
  success: number;
  failed: number;
}

// ── Internal types ────────────────────────────────────────────────────────────

interface DestinationWeatherInfo {
  destinationId: string;
  slug: string;
  ianaTimezone: string;
  latitude: number;
  longitude: number;
}

interface Counters {
  total: number;
  success: number;
  failed: number;
}

interface ArchiveResponse {
  hourly: {
    time: string[];
    precipitation: number[];
    temperature_2m: (number | null)[];
    apparent_temperature: (number | null)[];
    cloud_cover: (number | null)[];
    wind_speed_10m: (number | null)[];
    weather_code: (number | null)[];
  };
  daily: {
    time: string[];
    sunrise: string[];
    sunset: string[];
  };
}

interface MarineResponse {
  hourly: {
    time: string[];
    sea_surface_temperature: (number | null)[];
  };
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

// ── snapshot_runs bookkeeping (same shape as the flights job) ────────────────

async function startRun(
  supabase: SupabaseClient,
  dateRange: WeatherDateRange,
): Promise<string> {
  const { data, error } = await supabase
    .from('snapshot_runs')
    .insert({
      run_type: 'weather_annual',
      target_windows: [dateRange.label],
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

  if (error) console.error('[weather-snapshot] snapshot_runs UPDATE failed:', error.message);
}

// ── Reference data ────────────────────────────────────────────────────────────
//
// Deliberately just `destinations` — no school_urn parameter anywhere in
// this file, no school_term_dates/borough_term_dates query anywhere in
// this file. Confirmed by reading this function: it only ever needs a
// destination's own coordinates/timezone, never a specific school's term
// window.

async function loadDestinationWeatherInfo(
  supabase: SupabaseClient,
  slugs: readonly string[],
): Promise<DestinationWeatherInfo[]> {
  const { data, error } = await supabase
    .from('destinations')
    .select('id, slug, iana_timezone, latitude, longitude')
    .in('slug', [...slugs]);

  if (error) throw new Error(`destinations query failed: ${error.message}`);

  const rows = (data ?? []) as Array<{
    id: string;
    slug: string;
    iana_timezone: string | null;
    latitude: number | null;
    longitude: number | null;
  }>;
  console.log(`[weather-snapshot] destinations: ${rows.length} row(s)`);

  const infos: DestinationWeatherInfo[] = [];
  for (const row of rows) {
    if (row.latitude == null || row.longitude == null) {
      console.warn(`[weather-snapshot] WARNING: no coordinates for '${row.slug}' — skipping.`);
      continue;
    }
    if (!row.iana_timezone) {
      console.warn(`[weather-snapshot] WARNING: no iana_timezone for '${row.slug}' — skipping.`);
      continue;
    }
    infos.push({
      destinationId: row.id,
      slug: row.slug,
      ianaTimezone: row.iana_timezone,
      latitude: row.latitude,
      longitude: row.longitude,
    });
  }
  return infos;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Same calendar month/day, shifted to a different year (UTC-safe string math). */
function shiftYear(dateStr: string, year: number): string {
  const [, month, day] = dateStr.split('-');
  return `${year}-${month}-${day}`;
}

// ── Open-Meteo fetch helpers ──────────────────────────────────────────────────

async function fetchHistoricalWeather(
  latitude: number,
  longitude: number,
  startDate: string,
  endDate: string,
  timezone: string,
): Promise<ArchiveResponse> {
  const url =
    `https://archive-api.open-meteo.com/v1/archive` +
    `?latitude=${latitude}&longitude=${longitude}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&hourly=${ARCHIVE_HOURLY_VARS}` +
    `&daily=${ARCHIVE_DAILY_VARS}` +
    `&timezone=${encodeURIComponent(timezone)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Historical Weather API ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<ArchiveResponse>;
}

async function fetchMarineWeather(
  latitude: number,
  longitude: number,
  startDate: string,
  endDate: string,
  timezone: string,
): Promise<MarineResponse> {
  const url =
    `https://marine-api.open-meteo.com/v1/marine` +
    `?latitude=${latitude}&longitude=${longitude}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&hourly=${MARINE_HOURLY_VARS}` +
    `&timezone=${encodeURIComponent(timezone)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Marine Weather API ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<MarineResponse>;
}

// ── is_daylight computation ───────────────────────────────────────────────────

/**
 * Both hourly.time and daily.sunrise/sunset arrive as local wall-clock ISO
 * strings (no UTC offset) because the request passes timezone=<iana> — so
 * this is safe as plain lexicographic string comparison, no date-math needed.
 */
function computeIsDaylight(
  hourTimeLocal: string,
  dailyTimes: string[],
  dailySunrise: string[],
  dailySunset: string[],
): boolean {
  const dateKey = hourTimeLocal.slice(0, 10); // 'YYYY-MM-DD' prefix
  const dayIdx = dailyTimes.indexOf(dateKey);
  if (dayIdx === -1) return false;
  const sunrise = dailySunrise[dayIdx];
  const sunset = dailySunset[dayIdx];
  if (!sunrise || !sunset) return false;
  return hourTimeLocal >= sunrise && hourTimeLocal < sunset;
}

// ── weather_snapshots insert (upsert on the table's own unique key) ─────────

async function upsertWeatherSnapshots(
  supabase: SupabaseClient,
  destinationId: string,
  observedYear: number,
  archive: ArchiveResponse,
): Promise<{ ok: number; fail: number }> {
  const { time, precipitation, temperature_2m, apparent_temperature, cloud_cover, wind_speed_10m, weather_code } =
    archive.hourly;

  const records = time.map((t, i) => {
    // raw_json is a synthesized per-hour object, not the whole payload —
    // Open-Meteo's actual response is columnar (one array per variable,
    // parallel to a shared `time` array), so there is no natural per-hour
    // object in the wire format. Zipping one here means every row can
    // answer "what did the API return for this hour" on its own, without
    // needing to cross-reference a shared payload stored elsewhere.
    const rawHour = {
      time: t,
      precipitation: precipitation[i],
      temperature_2m: temperature_2m[i],
      apparent_temperature: apparent_temperature[i],
      cloud_cover: cloud_cover[i],
      wind_speed_10m: wind_speed_10m[i],
      weather_code: weather_code[i],
    };

    return {
      destination_id: destinationId,
      observed_year: observedYear,
      observed_date: t.slice(0, 10),
      observed_hour: Number(t.slice(11, 13)),
      precipitation_mm: precipitation[i] ?? 0,
      temperature_c: temperature_2m[i],
      apparent_temperature_c: apparent_temperature[i],
      cloud_cover_pct: cloud_cover[i],
      wind_speed_kmh: wind_speed_10m[i],
      weather_code: weather_code[i],
      is_daylight: computeIsDaylight(t, archive.daily.time, archive.daily.sunrise, archive.daily.sunset),
      raw_json: rawHour,
    };
  });

  if (records.length === 0) return { ok: 0, fail: 0 };

  const { error } = await supabase
    .from('weather_snapshots')
    .upsert(records, { onConflict: 'destination_id,observed_date,observed_hour' });

  if (error) {
    console.error(`[weather-snapshot] weather_snapshots upsert failed: ${error.message}`);
    return { ok: 0, fail: records.length };
  }
  return { ok: records.length, fail: 0 };
}

// ── weather_daily_context insert (upsert on the table's own PK) ─────────────

async function upsertDailyContext(
  supabase: SupabaseClient,
  destinationId: string,
  archive: ArchiveResponse,
  marine: MarineResponse | null,
): Promise<{ ok: number; fail: number }> {
  const { time: dailyTime, sunrise, sunset } = archive.daily;

  const records = dailyTime.map((date, i) => {
    let seaTempC: number | null = null;
    if (marine) {
      const idx = marine.hourly.time.indexOf(`${date}T${String(SEA_TEMP_REPRESENTATIVE_HOUR).padStart(2, '0')}:00`);
      if (idx !== -1) seaTempC = marine.hourly.sea_surface_temperature[idx] ?? null;
    }

    return {
      destination_id: destinationId,
      observed_date: date,
      sunrise_local: sunrise[i]?.slice(11), // 'HH:MM' portion of the local ISO timestamp
      sunset_local: sunset[i]?.slice(11),
      sea_surface_temp_c: seaTempC,
    };
  });

  if (records.length === 0) return { ok: 0, fail: 0 };

  const { error } = await supabase
    .from('weather_daily_context')
    .upsert(records, { onConflict: 'destination_id,observed_date' });

  if (error) {
    console.error(`[weather-snapshot] weather_daily_context upsert failed: ${error.message}`);
    return { ok: 0, fail: records.length };
  }
  return { ok: records.length, fail: 0 };
}

// ── Retry wrapper (same pattern as the flights job) ──────────────────────────

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
      console.warn(`[weather-snapshot] ${label} attempt ${i + 1} failed — retry in ${delay}ms`, err);
      if (i < maxAttempts - 1) await sleep(delay);
    }
  }
  console.error(`[weather-snapshot] ${label} — all ${maxAttempts} attempts failed`);
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runWeatherSnapshotJob(config: WeatherJobConfig): Promise<WeatherSnapshotJobResult> {
  const destinationSlugs = config.destinationSlugs ?? [...PILOT_SLUGS];
  const yearSpan = config.yearSpan ?? WEATHER_THRESHOLDS.stripYearSpan;
  const { dateRange } = config;

  console.log('[weather-snapshot] job started', new Date().toISOString());
  console.log(
    `[weather-snapshot] yearSpan=${yearSpan}  ` +
    `range=${dateRange.label} (${dateRange.rangeStart}..${dateRange.rangeEnd})`,
  );

  const supabase = getSupabase();
  const counters: Counters = { total: 0, success: 0, failed: 0 };

  // 1. Register run
  let runId: string;
  try {
    runId = await startRun(supabase, dateRange);
    console.log(`[weather-snapshot] run_id=${runId}`);
  } catch (err) {
    console.error('[weather-snapshot] Fatal — cannot register run:', err);
    throw err;
  }

  // 2. Load destination coordinates + timezones
  let destinations: DestinationWeatherInfo[];
  try {
    destinations = await loadDestinationWeatherInfo(supabase, destinationSlugs);
    if (destinations.length === 0) {
      const msg = 'No destinations with both coordinates and iana_timezone — nothing to fetch.';
      await finishRun(supabase, runId, counters, msg);
      console.error(`[weather-snapshot] ${msg}`);
      return { runId, ...counters };
    }
  } catch (err) {
    await finishRun(supabase, runId, counters, `destinations load failed: ${err}`);
    throw err;
  }

  // 3. Main loop: destination × historical year — no window/school dimension
  //    at all, by design (see file header).
  try {
    const rangeYear = Number(dateRange.rangeStart.slice(0, 4));
    const years = Array.from({ length: yearSpan }, (_, i) => rangeYear - yearSpan + i);

    console.log(
      `[weather-snapshot] ${dateRange.label}: ${years.length} years ` +
      `(${years[0]}–${years[years.length - 1]})`,
    );

    for (const dest of destinations) {
      for (const year of years) {
        const yearStart = shiftYear(dateRange.rangeStart, year);
        const yearEnd = shiftYear(dateRange.rangeEnd, year);
        const label = `${dest.slug} ${year} (${yearStart}..${yearEnd})`;

        counters.total++;
        await sleep(API_DELAY_MS);
        const archive = await withRetry(
          () => fetchHistoricalWeather(dest.latitude, dest.longitude, yearStart, yearEnd, dest.ianaTimezone),
          `archive ${label}`,
        );

        if (!archive) {
          counters.failed++;
          continue;
        }

        counters.total++;
        await sleep(API_DELAY_MS);
        const marine = await withRetry(
          () => fetchMarineWeather(dest.latitude, dest.longitude, yearStart, yearEnd, dest.ianaTimezone),
          `marine ${label}`,
        );
        if (!marine) counters.failed++; else counters.success++;

        const snapResult = await upsertWeatherSnapshots(supabase, dest.destinationId, year, archive);
        const ctxResult = await upsertDailyContext(supabase, dest.destinationId, archive, marine);

        console.log(
          `[weather-snapshot] ${label}: ` +
          `${snapResult.ok} hourly rows, ${ctxResult.ok} daily rows` +
          (snapResult.fail || ctxResult.fail ? ` (${snapResult.fail + ctxResult.fail} row failures)` : ''),
        );

        if (snapResult.fail > 0 || ctxResult.fail > 0) counters.failed++; else counters.success++;
      }
    }
  } catch (err) {
    console.error('[weather-snapshot] Unexpected error in main loop:', err);
    await finishRun(supabase, runId, counters, `Terminated with error: ${err}`);
    throw err;
  }

  // 4. Mark run complete
  await finishRun(supabase, runId, counters);
  console.log(
    `[weather-snapshot] job complete  ${new Date().toISOString()}  ` +
    `total=${counters.total}  success=${counters.success}  failed=${counters.failed}`,
  );
  return { runId, ...counters };
}

// ── Direct execution — wide Oct/Nov calendar range pilot ──────────────────────

/**
 * 15 Oct – 5 Nov: a wide calendar range comfortably covering every London
 * borough's actual October half-term window (including inset-day
 * extensions on either side) — not a specific school/borough's term
 * dates. This resolves the previous version's "STILL UNRESOLVED" blocker
 * (finding one real school's window_start/window_end) by making the
 * question moot: the raw fetch no longer needs any specific window at
 * all, borough-blind by design (see file header). The derived layer
 * (weather_window_stats/weather_strip_cells, a separate task) is what
 * will read the slice of this range that falls inside whatever window a
 * given school/borough actually has.
 */
export const OCT_NOV_RANGE: WeatherDateRange = {
  label:      'oct15-nov5',
  rangeStart: '2026-10-15',
  rangeEnd:   '2026-11-05',
};

if (require.main === module) {
  runWeatherSnapshotJob({
    dateRange: OCT_NOV_RANGE,
  }).catch(err => {
    console.error('[weather-snapshot] fatal:', err);
    process.exit(1);
  });
}
