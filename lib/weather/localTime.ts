/**
 * UTC instant -> destination wall-clock time, using the IANA tz database via
 * Intl.DateTimeFormat. No DST rules are hand-coded anywhere in this project:
 * the runtime's tzdata decides the offset for each individual instant.
 *
 * Why this exists: Open-Meteo's archive API labels an entire response with ONE
 * utc_offset (today's, for the requested zone — not the offset that applied on
 * each historical date), so `timezone=Europe/Madrid` mislabels every hour
 * after a clock change. `timezone=UTC` returns unambiguous instants instead;
 * we localise them ourselves here.
 */

export interface LocalParts {
  /** 'YYYY-MM-DD' in the destination's wall clock. */
  date: string;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone, // throws RangeError on an unknown IANA name — desirable, never silently UTC
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Open-Meteo's `timezone=UTC` ISO strings ('2025-10-26T16:53') carry no 'Z' — it is implied. */
export function parseUtcIso(iso: string): number {
  const ms = Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(iso) ? iso : `${iso}Z`);
  if (Number.isNaN(ms)) throw new Error(`unparseable UTC timestamp: '${iso}'`);
  return ms;
}

export function toLocalParts(instantMs: number, timeZone: string): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === t)!.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

export function formatHHMM(p: LocalParts): string {
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** Offset of `timeZone` from UTC in minutes at an instant (positive = ahead of UTC). */
export function utcOffsetMinutes(instantMs: number, timeZone: string): number {
  const p = toLocalParts(instantMs, timeZone);
  const [y, m, d] = p.date.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d, p.hour, p.minute) - Math.floor(instantMs / 60000) * 60000) / 60000);
}

export interface ClockChange {
  /** Local calendar date the new offset first applies, 'YYYY-MM-DD'. */
  date: string;
  /** 'back' (offset decreases, e.g. CEST->CET) or 'forward'. */
  direction: 'back' | 'forward';
}

/**
 * First UTC-offset change falling on a local date within [startDate, endDate], per the zone's
 * tz database for THOSE dates (so it is correct for a future year too). Compares the offset at
 * noon UTC on consecutive days; every real transition happens well away from noon UTC.
 */
export function findClockChange(startDate: string, endDate: string, timeZone: string): ClockChange | null {
  const day = (d: string, plus: number) => Date.parse(`${d}T12:00:00Z`) + plus * 86_400_000;
  const n = Math.round((day(endDate, 0) - day(startDate, 0)) / 86_400_000);
  // Compare each day with the previous one; day -1 lets a change ON startDate be seen.
  for (let i = 0; i <= n; i++) {
    const before = utcOffsetMinutes(day(startDate, i - 1), timeZone);
    const after = utcOffsetMinutes(day(startDate, i), timeZone);
    if (before !== after) {
      return { date: new Date(day(startDate, i)).toISOString().slice(0, 10), direction: after < before ? 'back' : 'forward' };
    }
  }
  return null;
}
