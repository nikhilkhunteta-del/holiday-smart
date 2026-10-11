/** npx tsx lib/weather/weatherWindow.check.ts — exits non-zero on any failure. */
import { weatherWindowFor } from './weatherWindow';

let failures = 0;
function check(input: [string, string], expected: [string, string, boolean] | null) {
  const got = weatherWindowFor(...input);
  const ok = expected === null ? got === null : !!got && got.start === expected[0] && got.end === expected[1] && got.extended === expected[2];
  if (!ok) { failures++; console.error(`FAIL ${input.join('..')} -> ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`); }
}

check(['2026-10-26', '2026-10-30'], ['2026-10-24', '2026-11-01', true]);  // Mon–Fri (brief's example)
check(['2026-10-19', '2026-10-30'], ['2026-10-17', '2026-11-01', true]);  // Mon–Fri, two weeks
check(['2026-10-25', '2026-10-31'], ['2026-10-24', '2026-11-01', true]);  // Sun -> Sat before; Sat -> Sun after
check(['2026-10-24', '2026-11-01'], ['2026-10-24', '2026-11-01', false]); // Sat–Sun: unchanged
check(['2026-10-22', '2026-10-30'], ['2026-10-22', '2026-11-01', true]);  // Thu start left alone
check(['2026-10-26', '2026-11-03'], ['2026-10-24', '2026-11-03', true]);  // Tue end left alone
check(['2026-11-03', '2026-11-03'], ['2026-11-03', '2026-11-03', false]); // single Tuesday
check(['2026-10-30', '2026-10-26'], null);
check(['2026-10-26', 'not-a-date'], null);

console.log(failures === 0 ? 'all weatherWindow checks passed' : `${failures} failure(s)`);
if (failures > 0) process.exit(1);
