/**
 * The weather window for a school's half-term: the half-term plus the weekend either side.
 *
 *   first day Sunday or Monday  -> start on the Saturday before
 *   last day Friday or Saturday -> end on the Sunday after
 *   any other weekday           -> that end is left alone
 *
 * e.g. Mon 26 – Fri 30 Oct -> Sat 24 Oct – Sun 1 Nov.
 *
 * Used ONLY by the Weather tab and the weather line on the Flights tab (to pick the stored
 * weather_window_stats row) and by the batch derivation (to decide which windows to store).
 * The Flights tab keeps using the school's own half-term dates.
 *
 * Pure and dependency-free: dates are 'YYYY-MM-DD' calendar dates, handled in UTC so the
 * server's own time zone can never shift a day.
 */

export interface WeatherWindow {
  start: string;
  end: string;
  /** True when either end moved, i.e. the window is wider than the half-term itself. */
  extended: boolean;
}

const DAY_MS = 86_400_000;

function shift(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Null when either date is malformed or end is before start. */
export function weatherWindowFor(halfTermStart: string, halfTermEnd: string): WeatherWindow | null {
  if (!ISO_DATE.test(halfTermStart) || !ISO_DATE.test(halfTermEnd)) return null;
  if (Number.isNaN(Date.parse(halfTermStart)) || Number.isNaN(Date.parse(halfTermEnd))) return null;
  if (halfTermEnd < halfTermStart) return null;

  const startDay = weekday(halfTermStart);
  const endDay = weekday(halfTermEnd);
  const start = startDay === 0 ? shift(halfTermStart, -1) : startDay === 1 ? shift(halfTermStart, -2) : halfTermStart;
  const end = endDay === 5 ? shift(halfTermEnd, 2) : endDay === 6 ? shift(halfTermEnd, 1) : halfTermEnd;
  return { start, end, extended: start !== halfTermStart || end !== halfTermEnd };
}
