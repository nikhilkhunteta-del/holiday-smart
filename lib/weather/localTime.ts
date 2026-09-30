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
