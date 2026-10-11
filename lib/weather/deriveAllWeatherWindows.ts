/**
 * Lists every distinct WEATHER window across all schools for one half-term, and optionally
 * runs the three derivation scripts (4a backfillWindowDerivation, 4b deriveWindowStatsRemainder,
 * 4c deriveSevereRainWarning) for each window x destination.
 *
 * A school's half-term dates are picked the same way the home page does (pages/index.js,
 * populatePills): the school's own school_term_dates row if it has one, otherwise its
 * borough's borough_term_dates row; the earliest-starting row in range wins. The weather window
 * is then weatherWindowFor() (lib/weather/weatherWindow.ts): the half-term plus the weekend
 * either side.
 *
 * Skipped, and listed with the reason:
 *   - single-day half-terms (e.g. two Kensington and Chelsea schools whose autumn half-term is
 *     stored as Tue 3 Nov only — almost certainly a data error, not a real half-term);
 *   - windows with any day the destination has no stored weather for (the raw tables hold
 *     only ~15 Oct – 5 Nov each year). 4a would refuse these anyway.
 *
 * Only ever writes rows keyed on the windows listed here; any other stored window (e.g. the
 * original 2026-10-19..2026-10-30 rows) is never touched, because every write is keyed on the
 * exact (destination, window_start, window_end).
 *
 * Read-only unless both --run and --write are given:
 *   (default)        list windows, school counts and skips; no scripts run
 *   --run            also run 4a/4b/4c for every window x destination in PREVIEW (writes nothing)
 *   --run --write    run them with --write
 *   --only=START..END  limit --run to one weather window
 *   --slugs=a,b      destinations (default: WEATHER_TAB_DESTINATIONS)
 *   --from/--to      half-term start-date range to consider (default 2026-09-01 .. 2026-12-31)
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx lib/weather/deriveAllWeatherWindows.ts [--run [--write]]
 */

import { execFileSync } from 'child_process';
import { weatherWindowFor } from './weatherWindow';
import { WEATHER_TAB_DESTINATIONS } from './weatherTabConfig';

const SUPABASE_REST = 'https://mlqkicbifcwjvfagtdbc.supabase.co/rest/v1';

async function pgGet(path: string, range?: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_REST}${path}`, { headers: range ? { Range: range } : {} });
  const text = await res.text();
  if (!res.ok) throw new Error(`PostgREST GET ${path} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : [];
}

/** All rows of a query, 1000 at a time (PostgREST's row cap). */
async function pgGetAll(path: string): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await pgGet(path, `${from}-${from + 999}`);
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find(a => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}
const flag = (name: string) => process.argv.slice(2).includes(`--${name}`);

const DAY_MS = 86_400_000;
const days = (s: string, e: string) => Math.round((Date.parse(e) - Date.parse(s)) / DAY_MS) + 1;
const dates = (s: string, e: string) =>
  Array.from({ length: days(s, e) }, (_, i) => new Date(Date.parse(`${s}T00:00:00Z`) + i * DAY_MS).toISOString().slice(0, 10));
const fmt = (d: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${d}T00:00:00Z`));

async function main() {
  const from = arg('from') ?? '2026-09-01';
  const to = arg('to') ?? '2026-12-31';
  const slugs = (arg('slugs') ?? WEATHER_TAB_DESTINATIONS.join(',')).split(',').filter(Boolean);
  const run = flag('run');
  const write = flag('write');
  const only = arg('only');
  if (write && !run) throw new Error('--write needs --run');

  // ── Each school's half-term, as the home page picks it ────────────────────
  const range = `term_label=eq.autumn_half_term&start_date=gte.${from}&start_date=lte.${to}`;
  const schools = await pgGetAll('/all_schools?select=urn,borough&order=urn');
  const schoolRows = await pgGetAll(`/school_term_dates?select=urn,start_date,end_date&${range}&order=urn`);
  const boroughRows = await pgGetAll(`/borough_term_dates?select=borough,start_date,end_date&${range}&order=borough`);
  const earliest = <K extends string>(rows: any[], key: K) => {
    const m = new Map<string, { start: string; end: string }>();
    for (const r of rows) {
      const cur = m.get(r[key]);
      if (!cur || r.start_date < cur.start) m.set(r[key], { start: r.start_date, end: r.end_date });
    }
    return m;
  };
  const bySchool = earliest(schoolRows, 'urn');
  const byBorough = earliest(boroughRows, 'borough');

  // ── Stored weather coverage per destination: month-days present in EVERY stored year ─
  const coverage = new Map<string, Set<string>>();
  for (const slug of slugs) {
    const [dest] = await pgGet(`/destinations?select=id&slug=eq.${slug}`);
    if (!dest) throw new Error(`no destination '${slug}'`);
    const rows = await pgGetAll(`/weather_daily_context?select=observed_date&destination_id=eq.${dest.id}`);
    const years = new Set(rows.map(r => r.observed_date.slice(0, 4)));
    const count = new Map<string, number>();
    for (const r of rows) count.set(r.observed_date.slice(5), (count.get(r.observed_date.slice(5)) ?? 0) + 1);
    coverage.set(slug, new Set([...count].filter(([, n]) => n === years.size).map(([md]) => md)));
  }

  // ── Group schools by weather window ───────────────────────────────────────
  type Group = { start: string; end: string; schools: number; halfTerms: Map<string, number>; skip: string | null };
  const groups = new Map<string, Group>();
  let noDates = 0;
  for (const s of schools) {
    const ht = bySchool.get(s.urn) ?? byBorough.get(s.borough);
    if (!ht) { noDates++; continue; }
    const w = weatherWindowFor(ht.start, ht.end);
    if (!w) throw new Error(`bad half-term dates for ${s.urn}: ${ht.start}..${ht.end}`);
    const key = `${w.start}..${w.end}`;
    let g = groups.get(key);
    if (!g) {
      let skip: string | null = null;
      if (ht.start === ht.end) skip = 'single-day half-term (looks like a data error)';
      else {
        for (const slug of slugs) {
          const missing = dates(w.start, w.end).filter(d => !coverage.get(slug)!.has(d.slice(5)));
          if (missing.length) { skip = `no stored weather for ${missing.map(fmt).join(', ')} (${slug})`; break; }
        }
      }
      g = { start: w.start, end: w.end, schools: 0, halfTerms: new Map(), skip };
      groups.set(key, g);
    }
    g.schools++;
    const htKey = `${fmt(ht.start)} – ${fmt(ht.end)}`;
    g.halfTerms.set(htKey, (g.halfTerms.get(htKey) ?? 0) + 1);
  }

  const sorted = [...groups.values()].sort((a, b) => (a.start + a.end).localeCompare(b.start + b.end));
  console.log(`Half-terms starting ${from}..${to}; ${schools.length} schools; ${noDates} with no half-term dates.\n`);
  for (const g of sorted) {
    const from = [...g.halfTerms].map(([k, n]) => `${k} (${n})`).join('; ');
    console.log(`${g.skip ? 'SKIP' : 'KEEP'}  ${fmt(g.start)} – ${fmt(g.end)} (${g.start}..${g.end}, ${days(g.start, g.end)} days): ${g.schools} schools` +
      `${g.skip ? ` — ${g.skip}` : ''}\n        from half-terms: ${from}`);
  }
  const kept = sorted.filter(g => !g.skip);
  console.log(`\n${kept.length} windows kept (${kept.reduce((n, g) => n + g.schools, 0)} schools), ` +
    `${sorted.length - kept.length} skipped (${sorted.filter(g => g.skip).reduce((n, g) => n + g.schools, 0)} schools).`);

  if (!run) return;

  // ── Run 4a -> 4b -> 4c per window x destination ───────────────────────────
  const targets = kept.filter(g => !only || only === `${g.start}..${g.end}`);
  if (only && targets.length === 0) throw new Error(`--only=${only} is not one of the kept windows`);
  for (const g of targets) {
    for (const slug of slugs) {
      for (const script of ['backfillWindowDerivation', 'deriveWindowStatsRemainder', 'deriveSevereRainWarning']) {
        const args = ['tsx', `lib/weather/${script}.ts`, `--slug=${slug}`, `--window-start=${g.start}`, `--window-end=${g.end}`];
        if (write) args.push('--write');
        console.log(`\n=== ${slug} ${g.start}..${g.end} ${script} ${write ? 'WRITE' : 'PREVIEW'} ===`);
        execFileSync('npx', args, { stdio: 'inherit' });
      }
    }
  }
}

main().catch(err => {
  console.error('[derive-all] fatal:', err);
  process.exit(1);
});
