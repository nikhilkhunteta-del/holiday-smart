/**
 * Server-only: reads the stored weather rows for the Weather tab. No AI calls, no Open-Meteo,
 * no writes — weather_window_stats and weather_strip_cells are pre-derived offline.
 *
 * Never throws: any read failure or missing row returns null and the tab is simply not shown.
 *
 * Which window: the school's half-term (the page's start/end) is widened to the weather window
 * by weatherWindowFor() — the half-term plus the weekend either side — and only a stats row for
 * EXACTLY that window is used. No exact row -> null, which hides the tab, the tab bar and the
 * weather line on the Flights tab. Never falls back to a different window's figures.
 */
import { supabaseServer as supabase } from '@/lib/supabase-server';
import { weatherTabEnabled } from './weatherTabConfig';
import { weatherWindowFor } from './weatherWindow';
import type { WeatherWindowStatsRow } from './computeWeatherVerdict';

export type StripCellState = 'dry' | 'some_rain' | 'washout';

export interface WeatherStatsRow extends WeatherWindowStatsRow {
  window_start: string;
  window_end: string;
  headline_years_used?: number | string | null;
  typical_washout_days?: number | string | null;
  washout_days_min?: number | string | null;
  washout_days_max?: number | string | null;
  hourly_rain_share?: Record<string, number | string> | null;
  daylight_hours_minutes?: string | null;
}

export interface WeatherTabData {
  destinationName: string;
  row: WeatherStatsRow;
  /** True when the weather window is wider than the school's half-term itself. */
  extended: boolean;
  /** strip_year -> cell state per day_offset (index = day_offset). Missing days are null. */
  strip: { year: number; days: (StripCellState | null)[] }[];
  /** Latest strip year (the headline years are the most recent headline_years_used of the strip). */
  latestStripYear: number | null;
  /** Of the headline years, how many had no washout day at all — counted from the stored strip. */
  headlineNoWashoutYears: number | null;
  /** Of all strip years, how many had no washout day at all — counted from the stored strip. */
  stripNoWashoutYears: number | null;
}

const DAY_MS = 86_400_000;
const toUtc = (d: string) => Date.parse(`${d}T00:00:00Z`);

export function windowLengthDays(start: string, end: string): number {
  return Math.round((toUtc(end) - toUtc(start)) / DAY_MS) + 1;
}

export async function loadWeatherTab(
  destinationSlug: string,
  pageWindowStart: string,
  pageWindowEnd: string,
): Promise<WeatherTabData | null> {
  if (!weatherTabEnabled(destinationSlug)) return null;
  const window = weatherWindowFor(pageWindowStart, pageWindowEnd);
  if (!window) return null;
  try {
    const dest = await supabase.from('destinations').select('id, name').eq('slug', destinationSlug).maybeSingle();
    if (dest.error || !dest.data) return null;
    const destinationId = (dest.data as any).id as string;

    const stats = await supabase
      .from('weather_window_stats')
      .select('*')
      .eq('destination_id', destinationId)
      .eq('window_start', window.start)
      .eq('window_end', window.end)
      .maybeSingle();
    if (stats.error || !stats.data) return null;
    const row = stats.data as WeatherStatsRow;

    const cells = await supabase
      .from('weather_strip_cells')
      .select('strip_year, day_offset, cell_state')
      .eq('destination_id', destinationId)
      .eq('window_start', row.window_start)
      .eq('window_end', row.window_end);

    const days = windowLengthDays(row.window_start, row.window_end);
    const byYear = new Map<number, (StripCellState | null)[]>();
    if (!cells.error && cells.data && days > 0 && days <= 31) {
      for (const c of cells.data as { strip_year: number; day_offset: number; cell_state: StripCellState }[]) {
        if (c.day_offset < 0 || c.day_offset >= days) continue;
        if (!byYear.has(c.strip_year)) byYear.set(c.strip_year, Array(days).fill(null));
        byYear.get(c.strip_year)![c.day_offset] = c.cell_state;
      }
    }
    const strip = Array.from(byYear.entries())
      .sort((a, b) => b[0] - a[0]) // newest first
      .map(([year, d]) => ({ year, days: d }));

    // No-washout years, counted from the same stored cells the strip draws. A year with a
    // missing cell is left out of both counts rather than guessed.
    const complete = strip.filter(s => s.days.every(d => d !== null));
    const noWashout = (years: typeof strip) => years.filter(s => !s.days.includes('washout')).length;
    const headlineN = Number(row.headline_years_used ?? row.headline_total_years);
    const headlineYears = Number.isFinite(headlineN) ? complete.slice(0, headlineN) : [];
    const allComplete = strip.length > 0 && complete.length === strip.length;

    const destinationName = String((dest.data as any).name ?? destinationSlug).split(',')[0];
    return {
      destinationName,
      row,
      extended: window.extended,
      strip,
      latestStripYear: strip[0]?.year ?? null,
      headlineNoWashoutYears: allComplete && headlineYears.length === headlineN ? noWashout(headlineYears) : null,
      stripNoWashoutYears: allComplete ? noWashout(strip) : null,
    };
  } catch (e) {
    console.error('[loadWeatherTab] failed:', e);
    return null;
  }
}
