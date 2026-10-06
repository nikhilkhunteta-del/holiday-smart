/**
 * Server-only: reads the stored weather rows for the Weather tab. No AI calls, no Open-Meteo,
 * no writes — weather_window_stats and weather_strip_cells are pre-derived offline.
 *
 * Never throws: any read failure or missing row returns null and the tab is simply not shown.
 *
 * Which window: the rows are keyed on their own (window_start, window_end), which need not equal
 * the page's school window. An exact match wins; otherwise the row whose window overlaps the
 * page's window the most; no overlap -> null. The tab then shows the ROW's dates, so the copy
 * always describes the days the figures were actually computed for.
 */
import { supabaseServer as supabase } from '@/lib/supabase-server';
import { weatherTabEnabled } from './weatherTabConfig';
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
  /** strip_year -> cell state per day_offset (index = day_offset). Missing days are null. */
  strip: { year: number; days: (StripCellState | null)[] }[];
}

const DAY_MS = 86_400_000;
const toUtc = (d: string) => Date.parse(`${d}T00:00:00Z`);

function overlapDays(aStart: string, aEnd: string, bStart: string, bEnd: string): number {
  const start = Math.max(toUtc(aStart), toUtc(bStart));
  const end = Math.min(toUtc(aEnd), toUtc(bEnd));
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? (end - start) / DAY_MS + 1 : 0;
}

export function windowLengthDays(start: string, end: string): number {
  return Math.round((toUtc(end) - toUtc(start)) / DAY_MS) + 1;
}

export async function loadWeatherTab(
  destinationSlug: string,
  pageWindowStart: string,
  pageWindowEnd: string,
): Promise<WeatherTabData | null> {
  if (!weatherTabEnabled(destinationSlug)) return null;
  try {
    const dest = await supabase.from('destinations').select('id, name').eq('slug', destinationSlug).maybeSingle();
    if (dest.error || !dest.data) return null;
    const destinationId = (dest.data as any).id as string;

    const stats = await supabase.from('weather_window_stats').select('*').eq('destination_id', destinationId);
    if (stats.error || !stats.data?.length) return null;

    const rows = stats.data as WeatherStatsRow[];
    const row =
      rows.find(r => r.window_start === pageWindowStart && r.window_end === pageWindowEnd) ??
      rows
        .map(r => ({ r, o: overlapDays(r.window_start, r.window_end, pageWindowStart, pageWindowEnd) }))
        .filter(x => x.o > 0)
        .sort((a, b) => b.o - a.o)[0]?.r;
    if (!row) return null;

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

    const destinationName = String((dest.data as any).name ?? destinationSlug).split(',')[0];
    return { destinationName, row, strip };
  } catch (e) {
    console.error('[loadWeatherTab] failed:', e);
    return null;
  }
}
