/**
 * Standalone check for localTime.ts / localizeArchive.ts — no test framework.
 *   npx tsx lib/weather/localTime.check.ts        (exits non-zero on any failure)
 *
 * Three independent sources per row:
 *   expected  — hard-coded by hand from the EU rule (clocks change at 01:00 UTC on the
 *               last Sunday of March / October; CET = UTC+1, CEST = UTC+2). This file is
 *               the ONLY place that rule is written down, and only as test data.
 *   intl      — what localTime.ts returns (Intl.DateTimeFormat + IANA zone).
 *   system    — `TZ=<zone> date`, i.e. the OS's own tzdata, a separate implementation.
 *
 * Europe/Madrid covers barcelona AND andalusian-corridor; Europe/Malta covers malta.
 */

import { execFileSync } from 'node:child_process';
import { formatHHMM, toLocalParts, parseUtcIso } from './localTime';
import { localizeArchive } from './localizeArchive';

let failures = 0;
const fmt = (p: { date: string; hour: number; minute: number }) => `${p.date} ${formatHHMM(p)}`;

function systemLocal(utcIso: string, tz: string): string {
  const out = execFileSync('date', ['-d', `${utcIso}Z`, '+%Y-%m-%d %H:%M'], { env: { ...process.env, TZ: tz } });
  return out.toString().trim();
}

// [zone, UTC instant, expected local wall clock, what it demonstrates]
const CASES: Array<[string, string, string, string]> = [
  // ── Autumn change, 2025: Sun 26 Oct, 01:00 UTC ──
  ['Europe/Madrid', '2025-10-25T16:55', '2025-10-25 18:55', 'sunset day before change (CEST) — API real value'],
  ['Europe/Madrid', '2025-10-26T16:53', '2025-10-26 17:53', 'sunset day of change (CET) — the value we mislabelled as 18:53'],
  ['Europe/Madrid', '2025-10-27T16:52', '2025-10-27 17:52', 'sunset day after (CET)'],
  ['Europe/Madrid', '2025-10-26T00:59', '2025-10-26 02:59', 'last minute before change (CEST)'],
  ['Europe/Madrid', '2025-10-26T01:00', '2025-10-26 02:00', 'first minute after change (CET) — 02:xx repeats'],
  ['Europe/Madrid', '2025-10-26T06:15', '2025-10-26 07:15', 'sunrise on change day (CET) — API real value'],
  // ── Other years, autumn: 2022-10-30, 2023-10-29, 2024-10-27 ──
  ['Europe/Madrid', '2022-10-30T00:59', '2022-10-30 02:59', '2022 before change'],
  ['Europe/Madrid', '2022-10-30T01:00', '2022-10-30 02:00', '2022 after change'],
  ['Europe/Madrid', '2023-10-29T01:00', '2023-10-29 02:00', '2023 after change'],
  ['Europe/Madrid', '2024-10-27T00:00', '2024-10-27 02:00', '2024 before change (CEST)'],
  ['Europe/Madrid', '2024-10-27T02:00', '2024-10-27 03:00', '2024 after change (CET)'],
  // ── Spring change, 2025: Sun 30 Mar, 01:00 UTC — local 02:xx never occurs ──
  ['Europe/Madrid', '2025-03-30T00:59', '2025-03-30 01:59', 'spring: last minute CET'],
  ['Europe/Madrid', '2025-03-30T01:00', '2025-03-30 03:00', 'spring: first minute CEST (02:xx skipped)'],
  // ── Mid-winter / mid-summer sanity (the exact cases the API got wrong: Jan was labelled +2) ──
  ['Europe/Madrid', '2025-01-15T16:46', '2025-01-15 17:46', 'January sunset is CET (+1), not +2'],
  ['Europe/Madrid', '2025-07-15T19:23', '2025-07-15 21:23', 'July sunset is CEST (+2)'],
  // ── Malta: same EU rule, separate zone entry ──
  ['Europe/Malta', '2025-10-25T23:30', '2025-10-26 01:30', 'Malta before change (CEST)'],
  ['Europe/Malta', '2025-10-26T00:59', '2025-10-26 02:59', 'Malta last minute before change'],
  ['Europe/Malta', '2025-10-26T01:00', '2025-10-26 02:00', 'Malta first minute after change (CET)'],
  ['Europe/Malta', '2025-10-26T16:00', '2025-10-26 17:00', 'Malta afternoon after change (CET)'],
  ['Europe/Malta', '2024-10-27T01:00', '2024-10-27 02:00', 'Malta 2024 after change'],
  ['Europe/Malta', '2025-03-30T01:00', '2025-03-30 03:00', 'Malta spring (02:xx skipped)'],
  ['Europe/Malta', '2025-01-15T12:00', '2025-01-15 13:00', 'Malta January (CET)'],
];

console.log('zone            UTC instant        expected           intl               system(date)       result  note');
for (const [tz, utc, expected, note] of CASES) {
  const intl = fmt(toLocalParts(parseUtcIso(utc), tz));
  const sys = systemLocal(utc, tz);
  const ok = intl === expected && sys === expected;
  if (!ok) failures++;
  console.log(`${tz.padEnd(15)} ${utc.padEnd(18)} ${expected.padEnd(18)} ${intl.padEnd(18)} ${sys.padEnd(18)} ${ok ? 'PASS' : 'FAIL'}    ${note}`);
}

// ── localizeArchive on real Open-Meteo values (timezone=UTC, fetched earlier this session) ──
console.log('\nlocalizeArchive, real UTC daily values for Barcelona 24-27 Oct 2025 + synthetic hourly 24-28 Oct:');
const days = ['2025-10-24', '2025-10-25', '2025-10-26', '2025-10-27'];
const rise = ['06:13', '06:14', '06:15', '06:17'];
const set = ['16:56', '16:55', '16:53', '16:52'];
const hours: string[] = [];
for (let d = 24; d <= 28; d++) for (let h = 0; h < 24; h++) hours.push(`2025-10-${d}T${String(h).padStart(2, '0')}:00`);
const n = hours.length;
const out = localizeArchive(
  {
    hourly: {
      time: hours, precipitation: hours.map(() => 0), temperature_2m: hours.map(() => 15),
      apparent_temperature: hours.map(() => 15), cloud_cover: hours.map(() => 0),
      wind_speed_10m: hours.map(() => 0), weather_code: hours.map(() => 0),
    },
    daily: { time: days, sunrise: days.map((d, i) => `${d}T${rise[i]}`), sunset: days.map((d, i) => `${d}T${set[i]}`) },
  },
  null, 'Europe/Madrid', '2025-10-25', '2025-10-27', 12,
);
const expectDaily = [
  ['2025-10-25', '08:14', '18:55'],
  ['2025-10-26', '07:15', '17:53'],
  ['2025-10-27', '07:17', '17:52'],
];
for (const [i, e] of expectDaily.entries()) {
  const g = out.daily[i];
  const ok = g && g.observed_date === e[0] && g.sunrise_local === e[1] && g.sunset_local === e[2];
  if (!ok) failures++;
  console.log(`  daily ${e[0]}: expected ${e[1]}/${e[2]}  got ${g?.sunrise_local}/${g?.sunset_local}  ${ok ? 'PASS' : 'FAIL'}`);
}
const dayHours = (date: string) => out.hourly.filter(r => r.observed_date === date && r.is_daylight).map(r => r.observed_hour);
// 26 Oct (CET): sunrise 07:15 -> first full daylight hour 08; sunset 17:53 -> last hour 17.
const expectDay: Array<[string, number[]]> = [
  ['2025-10-25', [9, 10, 11, 12, 13, 14, 15, 16, 17, 18]],
  ['2025-10-26', [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]],
  ['2025-10-27', [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]],
];
for (const [date, exp] of expectDay) {
  const got = dayHours(date);
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  if (!ok) failures++;
  console.log(`  is_daylight hours ${date}: expected ${exp.join(',')}  got ${got.join(',')}  ${ok ? 'PASS' : 'FAIL'}`);
}
const perDay = (d: string) => out.hourly.filter(r => r.observed_date === d).length;
const okCounts = perDay('2025-10-25') === 24 && perDay('2025-10-26') === 24 && perDay('2025-10-27') === 24 && out.repeatedHoursDropped === 1;
if (!okCounts) failures++;
console.log(`  rows/day 25,26,27 Oct = ${perDay('2025-10-25')},${perDay('2025-10-26')},${perDay('2025-10-27')} (24 each, key is date+hour); repeated 02:00 hour dropped = ${out.repeatedHoursDropped} (expected 1)  ${okCounts ? 'PASS' : 'FAIL'}`);
const kept = out.hourly.find(r => r.observed_date === '2025-10-26' && r.observed_hour === 2)!;
const okKept = (kept.raw_json.time_utc as string) === '2025-10-26T00:00Z';
if (!okKept) failures++;
console.log(`  kept 02:00 on 26 Oct is the EARLIER instant (${kept.raw_json.time_utc})  ${okKept ? 'PASS' : 'FAIL'}`);
void n;

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
