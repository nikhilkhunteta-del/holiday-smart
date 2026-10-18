/**
 * Task 4d: the weather verdict for one weather_window_stats row, computed at render time.
 *
 * Pure: no AI calls, no database access, no writes. Same condition -> category -> template
 * shape as computeSavingCategory() (lib/flights/assembleRecommendation.ts): each category is
 * chosen by threshold checks run top-down, and the copy is a fixed template per category.
 * Every boundary comes from WEATHER_THRESHOLDS — nothing numeric is hardcoded here.
 *
 * Spans: the headline and the temperature card use the headline span (10 years); very heavy
 * rain comes from the strip span and says "in the last N years" with the row's own
 * strip_years_used. The sea card states the exact years it rests on.
 *
 * Rain timing: "Mornings are usually dry" only when pct_daylight_rain_after_2pm reaches
 * WEATHER_THRESHOLDS.rainTimingLateDayMinPct; otherwise neutral wording.
 *
 * Missing/NULL fields never throw: each part whose inputs are missing comes back null and the
 * tab leaves it out.
 *
 * Never compares destinations and never ranks on the severe-rain count — it only describes
 * the one row it is given.
 */

import { WEATHER_THRESHOLDS as T } from './thresholds';

export type WeatherTier = 'reliable' | 'mostly_fine' | 'mixed' | 'unreliable';
export type RainTiming = 'late_day' | 'spread';
export type SeaFeel = 'comfortable' | 'swimmable' | 'cold';

/** One of the three cards under the strip: a large figure, a small label, a detail line. */
export interface WeatherCard {
  value: string;
  label: string;
  detail: string | null;
}

export interface WeatherVerdict {
  tier: WeatherTier | null;
  /** Short phrase per tier ("Rarely rained off."), shown alone as the large headline. */
  tierPhrase: string | null;
  /** The sentences after the tier phrase ("In 8 of the last 10 years…"), shown as the standfirst. */
  headline: string | null;
  /** What a "washout day" means, built from WEATHER_THRESHOLDS. Always present: it
   *  describes the definition, not the row. */
  definition: string;
  /** When daylight rain falls, as one sentence. Only 'late_day' may claim dry mornings. */
  rainTiming: { category: RainTiming; pct_after_2pm: number; text: string } | null;
  /** Typical afternoon feels-like, with mornings and evenings in the detail line. */
  temperature: WeatherCard | null;
  /** Sea temperature, with a sentence picked from the unrounded value. */
  sea: (WeatherCard & { feel: SeaFeel }) | null;
  /** Sunset (after the clocks change, or mid-trip) and the day's length. */
  daylight: WeatherCard | null;
  /** Very heavy rain, as one notes line with the real dates. */
  severeRain: string | null;
  /** "The headline counts {first}–{last}; the chart shows all 20 years, {first}–{last}. …"
   *  Null when the year span or counts are missing. */
  basis: string | null;
  /** The weather line on the Flights tab, without its "Weather:" label and link. */
  teaser: string | null;
}

/** Figures the verdict needs that are not columns of the row: counted from the stored
 *  strip cells by the loader (lib/weather/loadWeatherTab.ts). */
export interface WeatherVerdictExtras {
  /** Of the headline years, how many had no washout day at all. */
  headlineNoWashoutYears?: number | null;
  /** Latest strip year; the headline years are the most recent headline_years_used of the strip. */
  latestStripYear?: number | null;
}

/** The weather_window_stats columns the verdict reads. Everything is optional/nullable on
 *  purpose — the function is defensive against partial rows. Numerics may arrive as strings. */
export interface WeatherWindowStatsRow {
  headline_clean_year_count?: number | string | null;
  headline_total_years?: number | string | null;
  headline_years_used?: number | string | null;
  strip_years_used?: number | string | null;
  pct_daylight_rain_after_2pm?: number | string | null;
  morning_feelslike_c?: number | string | null;
  afternoon_feelslike_c?: number | string | null;
  evening_feelslike_c?: number | string | null;
  sea_temp_c?: number | string | null;
  sea_temp_years_used?: number | string | null;
  sea_temp_years?: string | null;
  daylight_hours_minutes?: string | null;
  sunset_mid_window?: string | null;
  clock_change_date?: string | null;
  sunset_before_change?: string | null;
  sunset_after_change?: string | null;
  severe_rain_warning_years?: number | string | null;
  severe_rain_threshold_mm?: number | string | null;
  severe_rain_dates?: string[] | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** number | numeric string -> finite number; anything else -> null. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "2023-2025" -> "2023–2025" (en dash for display; stored text uses a hyphen). */
function formatYears(years: string): string {
  return years.replace(/-/g, '–');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isoDate(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "2024-10-30" -> "30 Oct 2024". */
function formatDayMonthYear(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** ["a"] -> "a"; ["a","b"] -> "a and b"; ["a","b","c"] -> "a, b and c". */
function joinList(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

const HHMM = /^\d{2}:\d{2}$/;
const hhmmToMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** "10h 33m" -> "10½"; "10h 50m" -> "11" (nearest half hour). Null if unparseable. */
export function formatDaylightHours(hoursMinutes: string | null | undefined): string | null {
  const m = /^(\d+)h\s*(\d+)m$/.exec(hoursMinutes?.trim() ?? '');
  if (!m) return null;
  const halves = Math.round((Number(m[1]) * 60 + Number(m[2])) / 30);
  return `${Math.floor(halves / 2)}${halves % 2 ? '½' : ''}`;
}

/** The washout-day rule from WEATHER_THRESHOLDS, in plain words. */
export const WASHOUT_DEFINITION =
  `A washout day means ${T.washoutDayRainHours} or more hours of rain, ` +
  `or ${T.washoutDayTotalMm} mm or more, both counted in daylight hours only.`;

/** The strip's middle state, from the same thresholds (an "hour of rain" is one at or above
 *  meaningfulRainHourMm). */
export const SOME_RAIN_DEFINITION =
  `Some rain means at least one hour of ${T.meaningfulRainHourMm} mm or more in daylight, short of a washout.`;

// ── Tier: condition -> category ───────────────────────────────────────────────

export function computeWeatherTier(cleanYears: number): WeatherTier {
  if (cleanYears >= T.verdictReliableMinCleanYears) return 'reliable';
  if (cleanYears >= T.verdictMostlyFineMinCleanYears) return 'mostly_fine';
  if (cleanYears >= T.verdictMixedMinCleanYears) return 'mixed';
  return 'unreliable';
}

// ── Headline: category -> template ────────────────────────────────────────────
// States the number plainly; the tier only picks the closing clause. No adjectives about
// the destination, no comparison with anywhere else.

// `z` is the "In {n}, none at all." clause (or ''), placed straight after the sentence about
// years with at most one washout day, since the no-washout years are a subset of those.
const HEADLINE_TEMPLATES: Record<WeatherTier, (clean: number, total: number, z: string) => string> = {
  reliable: (c, t, z) => `In ${c} of the last ${t} years, these dates had at most one washout day.${z}`,
  mostly_fine: (c, t, z) => `In ${c} of the last ${t} years, these dates had at most one washout day.${z}`,
  mixed: (c, t, z) => `In ${c} of the last ${t} years, these dates had at most one washout day.${z} In the other ${t - c}, they had two or more.`,
  unreliable: (c, t, z) => `In ${t - c} of the last ${t} years, these dates had two or more washout days. In the other ${c}, they had at most one.${z}`,
};

/** " In {n}, none at all." — omitted when the count is unknown, or zero ("In 0, none at all"
 *  reads as a mistake; the at-most-one sentence already carries that case). */
function noWashoutClause(n: number | null): string {
  return n === null || n <= 0 ? '' : ` In ${n}, none at all.`;
}

// Short phrase per tier, about rain only (the tier is a washout count, not warmth).
const TIER_PHRASES: Record<WeatherTier, string> = {
  reliable: 'Rarely rained off.',
  mostly_fine: 'Mostly dry.',
  mixed: 'Hit and miss.',
  unreliable: 'Often rained off.',
};

// ── Rain timing: condition -> category -> template ───────────────────────────

export function computeRainTiming(pctAfter2pm: number): RainTiming {
  return pctAfter2pm >= T.rainTimingLateDayMinPct ? 'late_day' : 'spread';
}

const RAIN_TIMING_TEXT: Record<RainTiming, string> = {
  late_day: 'Mornings are usually dry.',
  spread: 'Rain can come at any time of day.',
};

// ── Sea: condition -> category -> template ────────────────────────────────────

export function computeSeaFeel(seaC: number): SeaFeel {
  if (seaC >= T.seaTempComfortableC) return 'comfortable';
  if (seaC >= T.seaTempSwimmableC) return 'swimmable';
  return 'cold';
}

const SEA_TEXT: Record<SeaFeel, string> = {
  comfortable: 'Comfortable for swimming.',
  swimmable: 'Cool but swimmable.',
  cold: 'Cold for most swimmers.',
};

// ── Main ──────────────────────────────────────────────────────────────────────

export function computeWeatherVerdict(
  row: WeatherWindowStatsRow | null | undefined,
  extras: WeatherVerdictExtras = {},
): WeatherVerdict {
  const r = row ?? {};

  // Tier + headline (headline span).
  const clean = num(r.headline_clean_year_count);
  const total = num(r.headline_total_years);
  const tier = clean === null ? null : computeWeatherTier(clean);
  const zero = num(extras.headlineNoWashoutYears);
  const headline =
    tier === null || clean === null || total === null
      ? null
      : HEADLINE_TEMPLATES[tier](clean, total, noWashoutClause(zero));
  const tierPhrase = tier === null ? null : TIER_PHRASES[tier];
  // The phrase's own full stop is dropped before the dash: "Rarely rained off — 8 of the last…".
  const teaser =
    tierPhrase === null || clean === null || total === null
      ? null
      : `${tierPhrase.replace(/\.$/, '')} — ${clean} of the last ${total} years had at most one washout day.`;

  // Rain timing (strip span: the share counts meaningful-rain daylight hours, not millimetres).
  const after2pm = num(r.pct_daylight_rain_after_2pm);
  let rainTiming: WeatherVerdict['rainTiming'] = null;
  if (after2pm !== null) {
    const category = computeRainTiming(after2pm);
    rainTiming = { category, pct_after_2pm: after2pm, text: RAIN_TIMING_TEXT[category] };
  }

  // Temperature (headline span): medians by part of day, whole degrees.
  const morning = num(r.morning_feelslike_c);
  const afternoon = num(r.afternoon_feelslike_c);
  const evening = num(r.evening_feelslike_c);
  const temperature: WeatherVerdict['temperature'] =
    afternoon === null
      ? null
      : {
          value: `${Math.round(afternoon)}°C`,
          label: 'Typical afternoon (feels-like)',
          detail:
            morning === null || evening === null
              ? null
              : `Mornings about ${Math.round(morning)}°C, evenings about ${Math.round(evening)}°C.`,
        };

  // Sea — omitted when NULL, or when the years it rests on are unknown. The sentence is picked
  // from the unrounded value, so 21.6 reads "Cool but swimmable." under a large "22°C".
  const seaC = num(r.sea_temp_c);
  const seaYears = r.sea_temp_years?.trim() || null;
  let sea: WeatherVerdict['sea'] = null;
  if (seaC !== null && seaYears !== null) {
    const feel = computeSeaFeel(seaC);
    const n = num(r.sea_temp_years_used);
    const basedOn =
      n === null
        ? `Based on ${formatYears(seaYears)}.`
        : `Based on ${total !== null && n < total ? 'only ' : ''}${n} ${n === 1 ? 'year' : 'years'} (${formatYears(seaYears)}).`;
    sea = { feel, value: `${Math.round(seaC)}°C`, label: 'Sea temperature', detail: `${SEA_TEXT[feel]} ${basedOn}` };
  }

  // Daylight: sunset after the clocks change when they change inside the window, otherwise
  // mid-trip; the day's length to the nearest half hour either way.
  const hours = formatDaylightHours(r.daylight_hours_minutes);
  const daylightSentence = hours === null ? null : `About ${hours} hours of daylight.`;
  const changeDay = r.clock_change_date ? isoDate(r.clock_change_date) : null;
  const before = r.sunset_before_change?.trim() ?? '';
  const after = r.sunset_after_change?.trim() ?? '';
  const mid = r.sunset_mid_window?.trim() ?? '';
  let daylight: WeatherVerdict['daylight'] = null;
  if (changeDay && HHMM.test(before) && HHMM.test(after)) {
    const way = hhmmToMin(after) < hhmmToMin(before) ? 'back' : 'forward';
    const day = `${WEEKDAYS[changeDay.getUTCDay()]} ${changeDay.getUTCDate()} ${MONTHS[changeDay.getUTCMonth()]}`;
    daylight = {
      value: after,
      label: `Sunset after clocks go ${way}`,
      detail: [`Clocks go ${way} on ${day}; sunset moves from about ${before} to ${after}.`, daylightSentence].filter(Boolean).join(' '),
    };
  } else if (HHMM.test(mid)) {
    daylight = { value: mid, label: 'Sunset, mid-trip', detail: daylightSentence };
  } else if (hours !== null) {
    // Sunset figures not derived yet for this window: the day's length alone.
    daylight = { value: `${hours} hours`, label: 'Daylight, mid-trip', detail: null };
  }

  // Very heavy rain (strip span), one notes line with the real dates.
  const stripYears = num(r.strip_years_used);
  const severe = num(r.severe_rain_warning_years);
  const thresholdMm = num(r.severe_rain_threshold_mm);
  let severeRain: string | null = null;
  if (severe !== null && thresholdMm !== null && stripYears !== null) {
    const mm = Math.round(thresholdMm);
    const span = `in the last ${stripYears} ${stripYears === 1 ? 'year' : 'years'}`;
    const days = (r.severe_rain_dates ?? []).map(isoDate).filter((d): d is Date => d !== null);
    if (severe === 0) {
      severeRain = `No day had more than about ${mm} mm of daylight rain ${span}.`;
    } else if (days.length > 0) {
      severeRain =
        `Very heavy rain (more than about ${mm} mm in daylight, heavy for this place in late October) ` +
        `happened on ${days.length} ${days.length === 1 ? 'day' : 'days'} ${span}: ${joinList(days.map(formatDayMonthYear))}.`;
    }
  }

  // Line under the standfirst: which years the headline counts and which the chart shows.
  const latest = num(extras.latestStripYear);
  const headlineSpan = num(r.headline_years_used) ?? total;
  const basis =
    stripYears === null || latest === null || headlineSpan === null
      ? null
      : `The headline counts ${latest - headlineSpan + 1}–${latest}; ` +
        `the chart shows all ${stripYears} years, ${latest - stripYears + 1}–${latest}. ` +
        'Based on past weather, not a forecast.';

  return {
    tier,
    tierPhrase,
    headline,
    definition: WASHOUT_DEFINITION,
    rainTiming,
    temperature,
    sea,
    daylight,
    severeRain,
    basis,
    teaser,
  };
}
