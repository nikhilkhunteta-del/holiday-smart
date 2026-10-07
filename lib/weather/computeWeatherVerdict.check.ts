/**
 * Standalone check for computeWeatherVerdict.ts — no test framework.
 *   npx tsx lib/weather/computeWeatherVerdict.check.ts        (exits non-zero on any failure)
 *   npx tsx lib/weather/computeWeatherVerdict.check.ts --print   (also prints the real verdicts)
 *
 * Real rows: the live barcelona and malta weather_window_stats rows (2026-10-19..2026-10-30),
 * copied verbatim minus hourly_rain_share/computed_at. andalusian-corridor is deliberately NOT
 * used: its row comes from the old inland hill point and is due to be replaced.
 */

import { computeWeatherVerdict, WeatherWindowStatsRow, WeatherVerdict } from './computeWeatherVerdict';
import { WEATHER_THRESHOLDS as T } from './thresholds';

let failures = 0;
let checks = 0;
function check(label: string, ok: boolean, detail = '') {
  checks++;
  if (!ok) {
    failures++;
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}
const kinds = (v: WeatherVerdict) => v.caveats.map(c => c.kind).join(',');

// ── Real rows ────────────────────────────────────────────────────────────────

const BARCELONA: WeatherWindowStatsRow = {
  headline_clean_year_count: 7,
  headline_total_years: 10,
  strip_years_used: 20,
  consecutive_washout_years: 3,
  daytime_feelslike_low_c: 13.4,
  daytime_feelslike_high_c: 23.3,
  sea_temp_c: 21.2,
  sea_temp_years: '2023-2025',
  severe_rain_warning_years: 2,
  severe_rain_threshold_mm: 24.54,
  severe_rain_years: '2019, 2024',
  sunset_shift_note: 'Clocks go back on Sun 25 Oct — sunset moves from about 18:56 to about 17:55.',
  evening_feelslike_low_c: 15.4,
  evening_feelslike_high_c: 22.6,
  pct_daylight_rain_after_2pm: 44.6,
};

const MALTA: WeatherWindowStatsRow = {
  headline_clean_year_count: 9,
  headline_total_years: 10,
  strip_years_used: 20,
  consecutive_washout_years: 3,
  daytime_feelslike_low_c: 17.5,
  daytime_feelslike_high_c: 26.3,
  sea_temp_c: 23.7,
  sea_temp_years: '2023-2025',
  severe_rain_warning_years: 1,
  severe_rain_threshold_mm: 20.0,
  severe_rain_years: '2021',
  sunset_shift_note: 'Clocks go back on Sun 25 Oct — sunset moves from about 18:15 to about 17:13.',
  evening_feelslike_low_c: 17.3,
  evening_feelslike_high_c: 25.2,
  pct_daylight_rain_after_2pm: 48.5,
};

const bcn = computeWeatherVerdict(BARCELONA);
const mlt = computeWeatherVerdict(MALTA);
check('barcelona tier', bcn.tier === 'mostly_fine', String(bcn.tier));
check('malta tier', mlt.tier === 'reliable', String(mlt.tier));
check('barcelona headline', bcn.headline === 'In 7 of the last 10 years, these dates had at most one washout day.', String(bcn.headline));
check('malta headline', mlt.headline === 'In 9 of the last 10 years, these dates had at most one washout day.', String(mlt.headline));
check('definition built from thresholds',
  bcn.definition === `A washout day means ${T.washoutDayRainHours} or more hours of rain in daylight, or ${T.washoutDayTotalMm} mm or more.`,
  bcn.definition);
check('definition reads 3 h / 8 mm today', bcn.definition === 'A washout day means 3 or more hours of rain in daylight, or 8 mm or more.', bcn.definition);
check('barcelona warmth', bcn.warmth?.band === 'mild', String(bcn.warmth?.band));
check('malta warmth', mlt.warmth?.band === 'warm', String(mlt.warmth?.band));
// Both real rows have consecutive_washout_years = 3, below the raised trigger of 5.
check('barcelona caveats', kinds(bcn) === 'severe_rain,sea_temperature,clock_change', kinds(bcn));
check('malta caveats', kinds(mlt) === 'severe_rain,sea_temperature,clock_change', kinds(mlt));
check('barcelona severe text',
  bcn.caveats[0].text === 'A very heavy rain day (more than 24.5 mm in daylight) has happened on these dates in 2 of the last 20 years, most recently 2024.',
  bcn.caveats[0].text);
check('malta severe text',
  mlt.caveats[0].text === 'A very heavy rain day (more than 20 mm in daylight) has happened on these dates in 1 of the last 20 years, most recently 2021.',
  mlt.caveats[0].text);
check('sea text states years', bcn.caveats[1].text.endsWith('Based on 2023–2025.'), bcn.caveats[1].text);

// ── Tier boundaries: every clean-year count 0..10 ───────────────────────────

const expectedTier = (c: number) =>
  c >= 8 ? 'reliable' : c >= 6 ? 'mostly_fine' : c >= 4 ? 'mixed' : 'unreliable';
check('threshold reliable = 8', T.verdictReliableMinCleanYears === 8);
check('threshold mostly_fine = 6', T.verdictMostlyFineMinCleanYears === 6);
check('threshold mixed = 4', T.verdictMixedMinCleanYears === 4);
for (let c = 0; c <= 10; c++) {
  const v = computeWeatherVerdict({ headline_clean_year_count: c, headline_total_years: 10 });
  check(`tier at ${c}`, v.tier === expectedTier(c), `got ${v.tier}`);
  check(`headline states ${c} at ${c}`, v.headline !== null && v.headline.includes(` of the last 10 years`), String(v.headline));
}
// The explicit boundary pairs called out in the brief.
for (const [c, t] of [[3, 'unreliable'], [4, 'mixed'], [5, 'mixed'], [6, 'mostly_fine'], [7, 'mostly_fine'], [8, 'reliable']] as const) {
  check(`boundary ${c} -> ${t}`, computeWeatherVerdict({ headline_clean_year_count: c, headline_total_years: 10 }).tier === t);
}
check('unreliable headline leads with the bad count',
  computeWeatherVerdict({ headline_clean_year_count: 3, headline_total_years: 10 }).headline ===
    'In 7 of the last 10 years, these dates had two or more washout days. In the other 3, they had at most one.');
check('mixed headline',
  computeWeatherVerdict({ headline_clean_year_count: 5, headline_total_years: 10 }).headline ===
    'In 5 of the last 10 years, these dates had at most one washout day. In the other 5, they had two or more.');
check('numeric strings accepted', computeWeatherVerdict({ headline_clean_year_count: '6', headline_total_years: '10' }).tier === 'mostly_fine');

// ── Warmth bands at their boundaries (midpoint of low/high) ─────────────────

const warmth = (lo: number, hi: number) => computeWeatherVerdict({ daytime_feelslike_low_c: lo, daytime_feelslike_high_c: hi }).warmth?.band;
check('cool just below mild', warmth(T.warmthMildMinC - 0.1, T.warmthMildMinC - 0.1) === 'cool');
check('mild at boundary', warmth(T.warmthMildMinC, T.warmthMildMinC) === 'mild');
check('warm at boundary', warmth(T.warmthWarmMinC, T.warmthWarmMinC) === 'warm');
check('mild just below warm', warmth(T.warmthWarmMinC - 0.1, T.warmthWarmMinC - 0.1) === 'mild');
check('hot at boundary', warmth(T.warmthHotMinC, T.warmthHotMinC) === 'hot');
check('warm just below hot', warmth(T.warmthHotMinC - 0.1, T.warmthHotMinC - 0.1) === 'warm');
check('warmth null when one bound missing', computeWeatherVerdict({ daytime_feelslike_low_c: 15 }).warmth === null);

// ── Each caveat on and off ───────────────────────────────────────────────────

const base: WeatherWindowStatsRow = { ...BARCELONA };
const has = (row: WeatherWindowStatsRow, k: string) => computeWeatherVerdict(row).caveats.some(c => c.kind === k);

check('severe on at min years', has({ ...base, severe_rain_warning_years: T.severeRainCaveatMinYears }, 'severe_rain'));
check('severe off at 0', !has({ ...base, severe_rain_warning_years: 0 }, 'severe_rain'));
check('severe off when count NULL', !has({ ...base, severe_rain_warning_years: null }, 'severe_rain'));
check('severe off when threshold NULL', !has({ ...base, severe_rain_threshold_mm: null }, 'severe_rain'));
check('severe without stored years drops "most recently"',
  computeWeatherVerdict({ ...base, severe_rain_years: null }).caveats[0].text ===
    'A very heavy rain day (more than 24.5 mm in daylight) has happened on these dates in 2 of the last 20 years.');
check('severe blank years drops "most recently"', !computeWeatherVerdict({ ...base, severe_rain_years: ' ' }).caveats[0].text.includes('most recently'));
check('severe most recent from a range', computeWeatherVerdict({ ...base, severe_rain_years: '2008, 2016-2018' }).caveats[0].text.endsWith('most recently 2018.'));
check('severe singular year', computeWeatherVerdict({ ...base, strip_years_used: 1, severe_rain_warning_years: 1 }).caveats[0].text.includes('1 of the last 1 year, most recently 2024.'));

check('back-to-back on at min', has({ ...base, consecutive_washout_years: T.backToBackWashoutCaveatMinYears }, 'back_to_back_washouts'));
check('back-to-back off below min', !has({ ...base, consecutive_washout_years: T.backToBackWashoutCaveatMinYears - 1 }, 'back_to_back_washouts'));
check('back-to-back off when NULL', !has({ ...base, consecutive_washout_years: null }, 'back_to_back_washouts'));
check('20-year caveats say "of the last 20 years"',
  computeWeatherVerdict({ ...base, consecutive_washout_years: 6 }).caveats.filter(c => c.kind === 'severe_rain' || c.kind === 'back_to_back_washouts').every(c => c.text.includes('of the last 20 years')));

const seaText = (t: number) => computeWeatherVerdict({ ...base, sea_temp_c: t }).caveats.find(c => c.kind === 'sea_temperature')?.text ?? '';
check('sea swimmable at threshold', seaText(T.seaTempSwimmableC).includes('warm enough to swim ('), seaText(T.seaTempSwimmableC));
check('sea not swimmable below', seaText(T.seaTempSwimmableC - 0.1).includes('below the'), seaText(T.seaTempSwimmableC - 0.1));
check('sea off when NULL (andalusian-style row)', !has({ ...base, sea_temp_c: null, sea_temp_years: null }, 'sea_temperature'));
check('sea off when years unknown', !has({ ...base, sea_temp_years: null }, 'sea_temperature'));

check('clock on when note present', has(base, 'clock_change'));
check('clock off when NULL', !has({ ...base, sunset_shift_note: null }, 'clock_change'));
check('clock off when blank', !has({ ...base, sunset_shift_note: '  ' }, 'clock_change'));

check('back-to-back trigger is 5', T.backToBackWashoutCaveatMinYears === 5);
check('back-to-back off at 3 (old trigger)', !has({ ...base, consecutive_washout_years: 3 }, 'back_to_back_washouts'));
check('back-to-back text', computeWeatherVerdict({ ...base, consecutive_washout_years: 5 }).caveats[1].text ===
  'Two washout days in a row happened on these dates in 5 of the last 20 years.');
check('caveat order fixed', kinds(computeWeatherVerdict({ ...base, consecutive_washout_years: 6 })) === 'severe_rain,back_to_back_washouts,sea_temperature,clock_change');
check('order holds with gaps', kinds(computeWeatherVerdict({ ...base, consecutive_washout_years: 0, sea_temp_c: null })) === 'severe_rain,clock_change');

// ── Tier phrase, rain timing, evenings, severe-rain summary ──────────────────

check('barcelona tier phrase', bcn.tierPhrase === 'Usually a good week.', String(bcn.tierPhrase));
check('malta tier phrase', mlt.tierPhrase === 'Rarely rained off.', String(mlt.tierPhrase));
// Barcelona's after-2pm share is 44.6%: it must NOT claim dry mornings.
check('barcelona rain timing is neutral', bcn.rainTiming?.category === 'spread' && !/dry/i.test(bcn.rainTiming.heading), JSON.stringify(bcn.rainTiming));
check('malta rain timing is neutral', mlt.rainTiming?.category === 'spread', JSON.stringify(mlt.rainTiming));
check('late-day at threshold',
  computeWeatherVerdict({ pct_daylight_rain_after_2pm: T.rainTimingLateDayMinPct }).rainTiming?.heading === 'Mornings are usually dry.');
check('spread just below threshold',
  computeWeatherVerdict({ pct_daylight_rain_after_2pm: T.rainTimingLateDayMinPct - 0.1 }).rainTiming?.category === 'spread');
check('no rain timing when missing', computeWeatherVerdict({}).rainTiming === null);
check('barcelona evenings', bcn.evenings?.text === 'Evenings usually feel like 15–23°C.', String(bcn.evenings?.text));
check('severe summary matches caveat', bcn.severeRain?.text === bcn.caveats[0].text && bcn.severeRain?.count === 2);
check('severe zero still summarised, no caveat', (() => {
  const v = computeWeatherVerdict({ ...BARCELONA, severe_rain_warning_years: 0, severe_rain_years: null });
  return v.severeRain?.count === 0 && !v.caveats.some(c => c.kind === 'severe_rain') && !/warning/i.test(v.severeRain.text);
})());
check('no "warning" anywhere in copy', !/warning/i.test(JSON.stringify([bcn, mlt])));
check('basis line', bcn.basis === 'Based on 20 years of hourly weather records for these exact dates. Not a forecast.', String(bcn.basis));

// ── Never throws on missing input ────────────────────────────────────────────

for (const [label, row] of [['null', null], ['undefined', undefined], ['empty', {}], ['garbage', { headline_clean_year_count: 'abc', sea_temp_c: 'x' } as WeatherWindowStatsRow]] as const) {
  try {
    const v = computeWeatherVerdict(row as WeatherWindowStatsRow | null | undefined);
    check(`${label}: all null/empty`, v.tier === null && v.tierPhrase === null && v.headline === null && v.warmth === null && v.evenings === null && v.rainTiming === null && v.severeRain === null && v.basis === null && v.caveats.length === 0 && v.definition.length > 0, JSON.stringify(v));
  } catch (e) {
    check(`${label}: threw`, false, String(e));
  }
}
check('tier without total -> headline null', computeWeatherVerdict({ headline_clean_year_count: 7 }).headline === null);

// ─────────────────────────────────────────────────────────────────────────────

if (process.argv.includes('--print')) {
  for (const [name, v] of [['Barcelona', bcn], ['Malta', mlt]] as const) console.log(`\n${name}\n${JSON.stringify(v, null, 2)}`);
}
console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
