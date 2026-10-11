/**
 * Task 4d: the weather verdict for one weather_window_stats row, computed at render time.
 *
 * Pure: no AI calls, no database access, no writes. Same condition -> category -> template
 * shape as computeSavingCategory() (lib/flights/assembleRecommendation.ts): each category is
 * chosen by threshold checks run top-down, and the copy is a fixed template per category.
 * Every boundary comes from WEATHER_THRESHOLDS — nothing numeric is hardcoded here.
 *
 * Spans: the headline and warmth use the headline span (10 years); severe rain and
 * back-to-back washouts come from the strip span and always say "of the last N years" with
 * the row's own strip_years_used. Sea temperature states the exact years it rests on.
 *
 * Rain timing: "Mornings are usually dry" only when pct_daylight_rain_after_2pm reaches
 * WEATHER_THRESHOLDS.rainTimingLateDayMinPct; otherwise neutral wording.
 *
 * Missing/NULL fields never throw: a caveat whose inputs are missing is omitted, and
 * tier/headline/warmth come back null when their own inputs are missing.
 *
 * Never compares destinations and never ranks on the severe-rain count — it only describes
 * the one row it is given.
 */

import { WEATHER_THRESHOLDS as T } from './thresholds';

export type WeatherTier = 'reliable' | 'mostly_fine' | 'mixed' | 'unreliable';
export type WarmthBand = 'cool' | 'mild' | 'warm' | 'hot';
export type WeatherCaveatKind = 'severe_rain' | 'back_to_back_washouts' | 'sea_temperature' | 'clock_change';
export type RainTiming = 'late_day' | 'spread';

export interface WeatherCaveat {
  kind: WeatherCaveatKind;
  text: string;
}

export interface WeatherVerdict {
  tier: WeatherTier | null;
  /** Short lead-in phrase per tier ("Usually a good week."), shown before the headline. */
  tierPhrase: string | null;
  headline: string | null;
  /** What a "washout day" means, built from WEATHER_THRESHOLDS. Always present: it
   *  describes the definition, not the row. */
  definition: string;
  warmth: { band: WarmthBand; low_c: number; high_c: number; text: string } | null;
  /** Evening feels-like range (headline span). */
  evenings: { low_c: number; high_c: number; text: string } | null;
  /** When daylight rain falls. Only 'late_day' may claim dry mornings. */
  rainTiming: { category: RainTiming; pct_after_2pm: number; heading: string; stat_label: string } | null;
  /** Severe-rain summary for its own card — present for any count, including zero. */
  severeRain: { count: number; strip_years: number; text: string } | null;
  /** "Counted over {first}–{last} of the last N years; the chart shows all M. Not a forecast."
   *  Null when the year span or counts are missing. */
  basis: string | null;
  caveats: WeatherCaveat[];
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
  consecutive_washout_years?: number | string | null;
  daytime_feelslike_low_c?: number | string | null;
  daytime_feelslike_high_c?: number | string | null;
  evening_feelslike_low_c?: number | string | null;
  evening_feelslike_high_c?: number | string | null;
  pct_daylight_rain_after_2pm?: number | string | null;
  sea_temp_c?: number | string | null;
  sea_temp_years?: string | null;
  severe_rain_warning_years?: number | string | null;
  severe_rain_threshold_mm?: number | string | null;
  severe_rain_years?: string | null;
  sunset_shift_note?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** number | numeric string -> finite number; anything else -> null. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 24.54 -> "24.5", 20 -> "20". */
function formatMm(mm: number): string {
  const r = Math.round(mm * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** "2023-2025" -> "2023–2025" (en dash for display; stored text uses a hyphen). */
function formatYears(years: string): string {
  return years.replace(/-/g, '–');
}

const yearsWord = (n: number) => (n === 1 ? 'year' : 'years');

/** Latest year in a stored year list ("2019, 2024" -> 2024, "2016-2018" -> 2018); null if none. */
function latestYear(years: string | null | undefined): number | null {
  const found = (years ?? '').match(/\d{4}/g);
  return found ? Math.max(...found.map(Number)) : null;
}

/** The washout-day rule from WEATHER_THRESHOLDS, in plain words. */
export const WASHOUT_DEFINITION =
  `A washout day means ${T.washoutDayRainHours} or more hours of rain in daylight, ` +
  `or ${T.washoutDayTotalMm} mm or more.`;

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

// Short lead-in per tier, about rain only (the tier is a washout count, not warmth).
const TIER_PHRASES: Record<WeatherTier, string> = {
  reliable: 'Rarely rained off.',
  mostly_fine: 'Usually a good week.',
  mixed: 'Hit and miss.',
  unreliable: 'Often rained off.',
};

// ── Rain timing: condition -> category -> template ───────────────────────────

export function computeRainTiming(pctAfter2pm: number): RainTiming {
  return pctAfter2pm >= T.rainTimingLateDayMinPct ? 'late_day' : 'spread';
}

const RAIN_TIMING_HEADINGS: Record<RainTiming, string> = {
  late_day: 'Mornings are usually dry.',
  spread: 'Rain can come at any time of day.',
};

// ── Warmth: condition -> category -> template ─────────────────────────────────

export function computeWarmthBand(daytimeMidpointC: number): WarmthBand {
  if (daytimeMidpointC >= T.warmthHotMinC) return 'hot';
  if (daytimeMidpointC >= T.warmthWarmMinC) return 'warm';
  if (daytimeMidpointC >= T.warmthMildMinC) return 'mild';
  return 'cool';
}

const WARMTH_LABEL: Record<WarmthBand, string> = {
  cool: 'Cool',
  mild: 'Mild',
  warm: 'Warm',
  hot: 'Hot',
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

  // Warmth (headline span, daytime P10..P90 feels-like).
  const lo = num(r.daytime_feelslike_low_c);
  const hi = num(r.daytime_feelslike_high_c);
  let warmth: WeatherVerdict['warmth'] = null;
  if (lo !== null && hi !== null) {
    const band = computeWarmthBand((lo + hi) / 2);
    const span = total === null ? '' : `, based on the last ${total} years`;
    warmth = {
      band,
      low_c: lo,
      high_c: hi,
      text: `${WARMTH_LABEL[band]}: daytime usually feels like ${Math.round(lo)}–${Math.round(hi)}°C${span}.`,
    };
  }

  // Evenings (headline span).
  const eLo = num(r.evening_feelslike_low_c);
  const eHi = num(r.evening_feelslike_high_c);
  const evenings =
    eLo === null || eHi === null
      ? null
      : { low_c: eLo, high_c: eHi, text: `Evenings usually feel like ${Math.round(eLo)}–${Math.round(eHi)}°C.` };

  // Rain timing (strip span: the share counts meaningful-rain daylight hours, not millimetres).
  const after2pm = num(r.pct_daylight_rain_after_2pm);
  let rainTiming: WeatherVerdict['rainTiming'] = null;
  if (after2pm !== null) {
    const category = computeRainTiming(after2pm);
    rainTiming = {
      category,
      pct_after_2pm: after2pm,
      heading: RAIN_TIMING_HEADINGS[category],
      stat_label: 'of rainy daylight hours were after 2pm',
    };
  }

  // Caveats, fixed order, each only when its condition holds and its inputs exist.
  const caveats: WeatherCaveat[] = [];
  const stripYears = num(r.strip_years_used);
  const latest = num(extras.latestStripYear);
  const headlineSpan = num(r.headline_years_used) ?? total;
  const basis =
    stripYears === null || latest === null || headlineSpan === null || total === null
      ? null
      : `Counted over ${latest - headlineSpan + 1}–${latest} of the last ${total} years; ` +
        `the chart shows all ${stripYears}. Not a forecast.`;

  // 1. Severe rain (strip span). "most recently YYYY" only when the row stores the years.
  const severe = num(r.severe_rain_warning_years);
  const thresholdMm = num(r.severe_rain_threshold_mm);
  let severeRain: WeatherVerdict['severeRain'] = null;
  if (severe !== null && thresholdMm !== null && stripYears !== null) {
    const recent = latestYear(r.severe_rain_years);
    const text =
      severe === 0
        ? `No day with more than ${formatMm(thresholdMm)} mm of rain in daylight on these dates in the last ${stripYears} ${yearsWord(stripYears)}.`
        : `A very heavy rain day (more than ${formatMm(thresholdMm)} mm in daylight) has happened on these dates ` +
          `in ${severe} of the last ${stripYears} ${yearsWord(stripYears)}` +
          (recent === null ? '.' : `, most recently ${recent}.`);
    severeRain = { count: severe, strip_years: stripYears, text };
    if (severe >= T.severeRainCaveatMinYears) caveats.push({ kind: 'severe_rain', text });
  }

  // 2. Back-to-back washouts (strip span).
  const backToBack = num(r.consecutive_washout_years);
  if (backToBack !== null && stripYears !== null && backToBack >= T.backToBackWashoutCaveatMinYears) {
    caveats.push({
      kind: 'back_to_back_washouts',
      text: `Two washout days in a row happened on these dates in ${backToBack} of the last ${stripYears} ${yearsWord(stripYears)}.`,
    });
  }

  // 3. Sea temperature — omitted when NULL, or when the years it rests on are unknown.
  const sea = num(r.sea_temp_c);
  const seaYears = r.sea_temp_years?.trim() || null;
  if (sea !== null && seaYears !== null) {
    const seaC = Math.round(sea);
    const verdict =
      sea >= T.seaTempSwimmableC
        ? `warm enough to swim (${T.seaTempSwimmableC}°C or more)`
        : `below the ${T.seaTempSwimmableC}°C we treat as warm enough to swim`;
    caveats.push({
      kind: 'sea_temperature',
      text: `The sea averages about ${seaC}°C — ${verdict}. Based on ${formatYears(seaYears)}.`,
    });
  }

  // 4. Clock change — the stored note, verbatim.
  const note = r.sunset_shift_note?.trim();
  if (note) caveats.push({ kind: 'clock_change', text: note });

  return {
    tier,
    tierPhrase,
    headline,
    definition: WASHOUT_DEFINITION,
    warmth,
    evenings,
    rainTiming,
    severeRain,
    basis,
    caveats,
  };
}
