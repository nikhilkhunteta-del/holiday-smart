/**
 * Shared inputs for the Layer 3 weather derivation scripts (Tasks 4a/4b/4c:
 * backfillWindowDerivation.ts, deriveWindowStatsRemainder.ts,
 * deriveSevereRainWarning.ts). Replaces the per-script hardcoded
 * DESTINATION_SLUG / WINDOW_START / WINDOW_END / IANA_TIMEZONE constants.
 *
 *   --slug=<destination slug>      required
 *   --window-start=YYYY-MM-DD      required
 *   --window-end=YYYY-MM-DD        required
 *   --write                        actually write (4a/4b/4c all preview and write nothing otherwise)
 *
 * The destination's id, IANA time zone and coordinates are read from the
 * `destinations` row for that slug — never hardcoded here.
 */

export interface DerivationArgs {
  slug: string;
  windowStart: string;
  windowEnd: string;
  write: boolean;
}

export interface DestinationRow {
  id: string;
  slug: string;
  iana_timezone: string;
  latitude: number;
  longitude: number;
}

const USAGE = 'usage: --slug=<slug> --window-start=YYYY-MM-DD --window-end=YYYY-MM-DD [--write]';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDerivationArgs(argv: string[] = process.argv.slice(2)): DerivationArgs {
  const flags = new Map<string, string>();
  let write = false;
  for (const arg of argv) {
    if (arg === '--write' || arg === 'write') { write = true; continue; }
    const m = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!m) throw new Error(`unrecognised argument '${arg}'\n${USAGE}`);
    flags.set(m[1], m[2]);
  }
  const slug = flags.get('slug');
  const windowStart = flags.get('window-start');
  const windowEnd = flags.get('window-end');
  if (!slug || !windowStart || !windowEnd) throw new Error(`missing argument\n${USAGE}`);
  for (const d of [windowStart, windowEnd]) {
    if (!ISO_DATE.test(d) || Number.isNaN(Date.parse(d))) throw new Error(`invalid date '${d}'\n${USAGE}`);
  }
  if (windowEnd < windowStart) throw new Error(`window-end ${windowEnd} is before window-start ${windowStart}`);
  return { slug, windowStart, windowEnd, write };
}

/** Looks up the destinations row for a slug via the caller's PostgREST fetcher. */
export async function loadDestination(
  pgFetch: (path: string) => Promise<unknown>,
  slug: string,
): Promise<DestinationRow> {
  const qs = new URLSearchParams([
    ['select', 'id,slug,iana_timezone,latitude,longitude'],
    ['slug', `eq.${slug}`],
  ]).toString();
  const rows = (await pgFetch(`/destinations?${qs}`)) as Array<{
    id: string; slug: string; iana_timezone: string | null; latitude: number | string | null; longitude: number | string | null;
  }>;
  if (rows.length !== 1) throw new Error(`destinations lookup: expected 1 row for slug '${slug}', found ${rows.length}`);
  const r = rows[0];
  if (!r.iana_timezone) throw new Error(`destinations '${slug}' has no iana_timezone`);
  if (r.latitude == null || r.longitude == null) throw new Error(`destinations '${slug}' has no coordinates`);
  return { id: r.id, slug: r.slug, iana_timezone: r.iana_timezone, latitude: Number(r.latitude), longitude: Number(r.longitude) };
}
