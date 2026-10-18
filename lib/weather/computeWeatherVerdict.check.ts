/**
 * Standalone check for computeWeatherVerdict.ts — no test framework.
 *   npx tsx lib/weather/computeWeatherVerdict.check.ts        (exits non-zero on any failure)
 *   npx tsx lib/weather/computeWeatherVerdict.check.ts --print   (also prints the real verdicts)
 *
 * Real rows: the live barcelona and malta weather_window_stats rows for the weather window most
 * schools get (2026-10-24..2026-11-01), copied verbatim minus hourly_rain_share/computed_at,
 * plus the Task 4c/4e figures (severe_rain_dates, the feels-like medians, the sunsets) as
 * those scripts compute them from the stored history. andalusian-corridor is deliberately NOT
 * used: its row comes from the old inland hill point and is due to be replaced.
 */

import { computeWeatherVerdict, formatDaylightHours, WeatherWindowStatsRow } from './computeWeatherVerdict';
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

// ── Real rows ────────────────────────────────────────────────────────────────

const BARCELONA: WeatherWindowStatsRow = {
  headline_years_used: 10,
  headline_clean_year_count: 8,
  headline_total_years: 10,
  strip_years_used: 20,
  pct_daylight_rain_after_2pm: 42.7,
  sea_temp_c: 20.3,
  sea_temp_years_used: 3,
  sea_temp_years: '2023-2025',
  daylight_hours_minutes: '10h 33m',
  severe_rain_warning_years: 1,
  severe_rain_threshold_mm: 24.54,
  severe_rain_dates: ['2024-10-30'],
  morning_feelslike_c: 15.95,
  afternoon_feelslike_c: 20.05,
  evening_feelslike_c: 18.5,
  sunset_mid_window: '17:51',
  clock_change_date: '2026-10-25',
  sunset_before_change: '18:56',
  sunset_after_change: '17:55',
};

const MALTA: WeatherWindowStatsRow = {
  headline_years_used: 10,
  headline_clean_year_count: 8,
  headline_total_years: 10,
  strip_years_used: 20,
  pct_daylight_rain_after_2pm: 40.2,
  sea_temp_c: 23.6,
  sea_temp_years_used: 3,
  sea_temp_years: '2023-2025',
  daylight_hours_minutes: '10h 50m',
  severe_rain_warning_years: 1,
  severe_rain_threshold_mm: 20.0,
  severe_rain_dates: ['2021-10-28'],
  morning_feelslike_c: 21.3,
  afternoon_feelslike_c: 22.1,
  evening_feelslike_c: 21,
  sunset_mid_window: '17:10',
  clock_change_date: '2026-10-25',
  sunset_before_change: '18:15',
  sunset_after_change: '17:13',
};

const bcn = computeWeatherVerdict(BARCELONA, { latestStripYear: 2025, headlineNoWashoutYears: 7 });
const mlt = computeWeatherVerdict(MALTA, { latestStripYear: 2025, headlineNoWashoutYears: 6 });

check('barcelona tier phrase', bcn.tierPhrase === 'Rarely rained off.', String(bcn.tierPhrase));
check('malta tier phrase', mlt.tierPhrase === 'Rarely rained off.', String(mlt.tierPhrase));
check('barcelona standfirst', bcn.headline === 'In 8 of the last 10 years, these dates had at most one washout day. In 7, none at all.', String(bcn.headline));
check('malta standfirst', mlt.headline === 'In 8 of the last 10 years, these dates had at most one washout day. In 6, none at all.', String(mlt.headline));
check('basis line',
  bcn.basis === 'The headline counts 2016–2025; the chart shows all 20 years, 2006–2025. Based on past weather, not a forecast.',
  String(bcn.basis));
check('barcelona teaser', bcn.teaser === 'Rarely rained off — 8 of the last 10 years had at most one washout day.', String(bcn.teaser));

check('definition built from thresholds',
  bcn.definition === `A washout day means ${T.washoutDayRainHours} or more hours of rain, or ${T.washoutDayTotalMm} mm or more, both counted in daylight hours only.`,
  bcn.definition);
check('definition reads 3 h / 8 mm today',
  bcn.definition === 'A washout day means 3 or more hours of rain, or 8 mm or more, both counted in daylight hours only.', bcn.definition);

check('barcelona temperature', JSON.stringify(bcn.temperature) === JSON.stringify({
  value: '20°C', label: 'Typical afternoon (feels-like)', detail: 'Mornings about 16°C, evenings about 19°C.',
}), JSON.stringify(bcn.temperature));
check('malta temperature', mlt.temperature?.value === '22°C' && mlt.temperature.detail === 'Mornings about 21°C, evenings about 21°C.', JSON.stringify(mlt.temperature));

check('barcelona sea', bcn.sea?.value === '20°C' && bcn.sea.detail === 'Cool but swimmable. Based on only 3 years (2023–2025).', JSON.stringify(bcn.sea));
check('malta sea', mlt.sea?.value === '24°C' && mlt.sea.detail === 'Comfortable for swimming. Based on only 3 years (2023–2025).', JSON.stringify(mlt.sea));

check('barcelona daylight', JSON.stringify(bcn.daylight) === JSON.stringify({
  value: '17:55',
  label: 'Sunset after clocks go back',
  detail: 'Clocks go back on Sun 25 Oct; sunset moves from about 18:56 to 17:55. About 10½ hours of daylight.',
}), JSON.stringify(bcn.daylight));
check('malta daylight', mlt.daylight?.value === '17:13' && mlt.daylight.detail?.endsWith('About 11 hours of daylight.') === true, JSON.stringify(mlt.daylight));

check('barcelona severe',
  bcn.severeRain === 'Very heavy rain (more than about 25 mm in daylight, heavy for this place in late October) happened on 1 day in the last 20 years: 30 Oct 2024.',
  String(bcn.severeRain));
check('malta severe',
  mlt.severeRain === 'Very heavy rain (more than about 20 mm in daylight, heavy for this place in late October) happened on 1 day in the last 20 years: 28 Oct 2021.',
  String(mlt.severeRain));

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
  check(`teaser at ${c}`, v.teaser !== null && v.teaser.endsWith(`— ${c} of the last 10 years had at most one washout day.`), String(v.teaser));
}
for (const [c, t] of [[3, 'unreliable'], [4, 'mixed'], [5, 'mixed'], [6, 'mostly_fine'], [7, 'mostly_fine'], [8, 'reliable']] as const) {
  check(`boundary ${c} -> ${t}`, computeWeatherVerdict({ headline_clean_year_count: c, headline_total_years: 10 }).tier === t);
}
const phrase = (c: number) => computeWeatherVerdict({ headline_clean_year_count: c, headline_total_years: 10 }).tierPhrase;
check('phrases', [phrase(9), phrase(7), phrase(5), phrase(2)].join('|') === 'Rarely rained off.|Mostly dry.|Hit and miss.|Often rained off.');
check('unreliable headline leads with the bad count',
  computeWeatherVerdict({ headline_clean_year_count: 3, headline_total_years: 10 }).headline ===
    'In 7 of the last 10 years, these dates had two or more washout days. In the other 3, they had at most one.');
check('mixed headline',
  computeWeatherVerdict({ headline_clean_year_count: 5, headline_total_years: 10 }).headline ===
    'In 5 of the last 10 years, these dates had at most one washout day. In the other 5, they had two or more.');
check('numeric strings accepted', computeWeatherVerdict({ headline_clean_year_count: '6', headline_total_years: '10' }).tier === 'mostly_fine');

// "In {n}, none at all." straight after the at-most-one sentence, every tier.
const z = (clean: number, zero: number | null) =>
  computeWeatherVerdict({ headline_clean_year_count: clean, headline_total_years: 10 }, { headlineNoWashoutYears: zero }).headline;
check('none-at-all clause, mostly_fine', z(7, 4) === 'In 7 of the last 10 years, these dates had at most one washout day. In 4, none at all.', String(z(7, 4)));
check('none-at-all clause, mixed', z(5, 2) === 'In 5 of the last 10 years, these dates had at most one washout day. In 2, none at all. In the other 5, they had two or more.', String(z(5, 2)));
check('none-at-all clause, unreliable', z(3, 1) === 'In 7 of the last 10 years, these dates had two or more washout days. In the other 3, they had at most one. In 1, none at all.', String(z(3, 1)));
check('none-at-all clause omitted at zero', z(8, 0) === 'In 8 of the last 10 years, these dates had at most one washout day.', String(z(8, 0)));
check('none-at-all clause omitted when unknown', z(8, null) === 'In 8 of the last 10 years, these dates had at most one washout day.', String(z(8, null)));

check('basis null without latest year', computeWeatherVerdict(BARCELONA).basis === null);

// ── Rain timing ──────────────────────────────────────────────────────────────

check('barcelona rain timing is neutral', bcn.rainTiming?.text === 'Rain can come at any time of day.', JSON.stringify(bcn.rainTiming));
check('malta rain timing is neutral', mlt.rainTiming?.category === 'spread', JSON.stringify(mlt.rainTiming));
check('late-day at threshold',
  computeWeatherVerdict({ pct_daylight_rain_after_2pm: T.rainTimingLateDayMinPct }).rainTiming?.text === 'Mornings are usually dry.');
check('spread just below threshold',
  computeWeatherVerdict({ pct_daylight_rain_after_2pm: T.rainTimingLateDayMinPct - 0.1 }).rainTiming?.category === 'spread');
check('no rain timing when missing', computeWeatherVerdict({}).rainTiming === null);

// ── Temperature ──────────────────────────────────────────────────────────────

check('temperature null without afternoon', computeWeatherVerdict({ ...BARCELONA, afternoon_feelslike_c: null }).temperature === null);
check('temperature detail null without morning', computeWeatherVerdict({ ...BARCELONA, morning_feelslike_c: null }).temperature?.detail === null);
check('temperature rounds strings', computeWeatherVerdict({ afternoon_feelslike_c: '19.49' }).temperature?.value === '19°C');

// ── Sea: unrounded value picks the sentence ──────────────────────────────────

const seaDetail = (t: number) => computeWeatherVerdict({ ...BARCELONA, sea_temp_c: t }).sea?.detail ?? '';
check('sea comfortable at 22', seaDetail(T.seaTempComfortableC).startsWith('Comfortable for swimming.'), seaDetail(22));
check('sea swimmable just below 22', seaDetail(T.seaTempComfortableC - 0.1).startsWith('Cool but swimmable.'), seaDetail(21.9));
check('sea 21.6 shows 22 but says cool', computeWeatherVerdict({ ...BARCELONA, sea_temp_c: 21.6 }).sea?.value === '22°C' && seaDetail(21.6).startsWith('Cool but swimmable.'));
check('sea swimmable at 20', seaDetail(T.seaTempSwimmableC).startsWith('Cool but swimmable.'), seaDetail(20));
check('sea cold just below 20', seaDetail(T.seaTempSwimmableC - 0.1).startsWith('Cold for most swimmers.'), seaDetail(19.9));
check('sea off when NULL (andalusian-style row)', computeWeatherVerdict({ ...BARCELONA, sea_temp_c: null, sea_temp_years: null }).sea === null);
check('sea off when years unknown', computeWeatherVerdict({ ...BARCELONA, sea_temp_years: null }).sea === null);
check('sea "only" dropped at the full span', computeWeatherVerdict({ ...BARCELONA, sea_temp_years_used: 10, sea_temp_years: '2016-2025' }).sea?.detail === 'Cool but swimmable. Based on 10 years (2016–2025).');

// ── Daylight ─────────────────────────────────────────────────────────────────

check('half hours', ['10h 33m', '10h 50m', '10h 14m', '10h 15m', '10h 45m', 'x'].map(formatDaylightHours).join('|') === '10½|11|10|10½|11|');
const noChange = computeWeatherVerdict({ ...BARCELONA, clock_change_date: null, sunset_before_change: null, sunset_after_change: null }).daylight;
check('no clock change -> mid-trip sunset', JSON.stringify(noChange) === JSON.stringify({ value: '17:51', label: 'Sunset, mid-trip', detail: 'About 10½ hours of daylight.' }), JSON.stringify(noChange));
const notDerived = computeWeatherVerdict({ daylight_hours_minutes: '10h 33m' }).daylight;
check('sunsets not derived yet -> daylight length alone', notDerived?.value === '10½ hours' && notDerived.detail === null, JSON.stringify(notDerived));
check('clocks forward wording', computeWeatherVerdict({ clock_change_date: '2027-03-28', sunset_before_change: '18:40', sunset_after_change: '19:41' }).daylight?.label === 'Sunset after clocks go forward');
check('no daylight when nothing stored', computeWeatherVerdict({}).daylight === null);

// ── Very heavy rain ──────────────────────────────────────────────────────────

check('severe none', computeWeatherVerdict({ ...BARCELONA, severe_rain_warning_years: 0, severe_rain_dates: null }).severeRain ===
  'No day had more than about 25 mm of daylight rain in the last 20 years.');
check('severe several days, oldest first', computeWeatherVerdict({ ...BARCELONA, severe_rain_warning_years: 2, severe_rain_dates: ['2008-11-02', '2024-10-30', '2024-11-02'] }).severeRain ===
  'Very heavy rain (more than about 25 mm in daylight, heavy for this place in late October) happened on 3 days in the last 20 years: 2 Nov 2008, 30 Oct 2024 and 2 Nov 2024.');
check('severe omitted when dates not derived yet', computeWeatherVerdict({ ...BARCELONA, severe_rain_dates: null }).severeRain === null);
check('severe omitted when threshold NULL', computeWeatherVerdict({ ...BARCELONA, severe_rain_threshold_mm: null }).severeRain === null);
check('no "warning" anywhere in copy', !/warning/i.test(JSON.stringify([bcn, mlt])));

// ── Never throws on missing input ────────────────────────────────────────────

for (const [label, row] of [['null', null], ['undefined', undefined], ['empty', {}], ['garbage', { headline_clean_year_count: 'abc', sea_temp_c: 'x', clock_change_date: 'no', severe_rain_dates: ['x'] } as WeatherWindowStatsRow]] as const) {
  try {
    const v = computeWeatherVerdict(row as WeatherWindowStatsRow | null | undefined);
    check(`${label}: all null/empty`,
      v.tier === null && v.tierPhrase === null && v.headline === null && v.teaser === null && v.rainTiming === null &&
      v.temperature === null && v.sea === null && v.daylight === null && v.severeRain === null && v.basis === null && v.definition.length > 0,
      JSON.stringify(v));
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
