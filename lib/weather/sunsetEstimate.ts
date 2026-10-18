/**
 * Sunset on a calendar date of the window's own target year (e.g. 2026), estimated from the
 * stored history. No weather data exists for a future year, so the sunset is the mean over the
 * headline years of the real observed sunset on the SAME calendar date, taken as a UTC
 * time-of-day and then shown on the target year's own wall clock (so a date after the clocks go
 * back reads in winter time even when an older year's same date was still in summer time).
 * Sunset on a fixed date moves by a minute or two between years, hence "about" in all copy.
 *
 * Shared by Task 4b (deriveWindowStatsRemainder.ts, the old sunset_shift_note) and Task 4e
 * (deriveCardFigures.ts, the daylight card's sunset columns). Reads weather_daily_context only.
 */

import { toLocalParts, utcOffsetMinutes, formatHHMM } from './localTime';

const qs = (pairs: Array<[string, string]>) => new URLSearchParams(pairs).toString();

/** Mean UTC minute-of-day of the stored sunset on `target`'s month/day across `years`. */
async function sunsetUtcMinutes(
  pgFetch: (path: string) => Promise<unknown>,
  destinationId: string,
  years: number[],
  ianaTimezone: string,
  target: string,
): Promise<number> {
  const md = target.slice(5);
  const mins: number[] = [];
  for (const y of years) {
    const date = `${y}-${md}`;
    const row = (await pgFetch(
      `/weather_daily_context?${qs([
        ['select', 'sunset_local'],
        ['destination_id', `eq.${destinationId}`],
        ['observed_date', `eq.${date}`],
      ])}`,
    )) as Array<{ sunset_local: string }>;
    if (row.length !== 1) throw new Error(`no sunset for ${date} — cannot estimate ${target}`);
    // Stored sunset_local is wall-clock in THAT year; convert back to a UTC time-of-day.
    const [yy, mm, dd] = date.split('-').map(Number);
    const [hh, mi] = row[0].sunset_local.split(':').map(Number);
    let utc = Date.UTC(yy, mm - 1, dd, hh, mi);
    utc -= utcOffsetMinutes(utc, ianaTimezone) * 60_000; // approximate, then refine once
    utc = Date.UTC(yy, mm - 1, dd, hh, mi) - utcOffsetMinutes(utc, ianaTimezone) * 60_000;
    mins.push((utc % 86_400_000) / 60_000);
  }
  return mins.reduce((a, b) => a + b, 0) / mins.length;
}

/** Estimated sunset on `target` (YYYY-MM-DD, the target year), as "HH:MM" on that day's clock. */
export async function estimateSunset(
  pgFetch: (path: string) => Promise<unknown>,
  destinationId: string,
  years: number[],
  ianaTimezone: string,
  target: string,
): Promise<string> {
  const utcMinuteOfDay = await sunsetUtcMinutes(pgFetch, destinationId, years, ianaTimezone, target);
  const instant = Date.parse(`${target}T00:00:00Z`) + Math.round(utcMinuteOfDay) * 60_000;
  return formatHHMM(toLocalParts(instant, ianaTimezone));
}
