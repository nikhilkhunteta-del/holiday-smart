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

export interface WeatherCaveat {
  kind: WeatherCaveatKind;
  text: string;
}

export interface WeatherVerdict {
  tier: WeatherTier | null;
  headline: string | null;
  warmth: { band: WarmthBand; low_c: number; high_c: number; text: string } | null;
  caveats: WeatherCaveat[];
}

/** The weather_window_stats columns the verdict reads. Everything is optional/nullable on
 *  purpose — the function is defensive against partial rows. Numerics may arrive as strings. */
export interface WeatherWindowStatsRow {
  headline_clean_year_count?: number | string | null;
  headline_total_years?: number | string | null;
  strip_years_used?: number | string | null;
  consecutive_washout_years?: number | string | null;
  daytime_feelslike_low_c?: number | string | null;
  daytime_feelslike_high_c?: number | string | null;
  sea_temp_c?: number | string | null;
  sea_temp_years?: string | null;
  severe_rain_warning_years?: number | string | null;
  severe_rain_threshold_mm?: number | string | null;
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

const HEADLINE_TEMPLATES: Record<WeatherTier, (clean: number, total: number) => string> = {
  reliable: (c, t) => `In ${c} of the last ${t} years, this window had at most one washout day.`,
  mostly_fine: (c, t) => `In ${c} of the last ${t} years, this window had at most one washout day.`,
  mixed: (c, t) => `In ${c} of the last ${t} years, this window had at most one washout day. In the other ${t - c}, it had two or more.`,
  unreliable: (c, t) => `In ${t - c} of the last ${t} years, this window had two or more washout days. In the other ${c}, it had at most one.`,
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

export function computeWeatherVerdict(row: WeatherWindowStatsRow | null | undefined): WeatherVerdict {
  const r = row ?? {};

  // Tier + headline (headline span).
  const clean = num(r.headline_clean_year_count);
  const total = num(r.headline_total_years);
  const tier = clean === null ? null : computeWeatherTier(clean);
  const headline = tier === null || clean === null || total === null ? null : HEADLINE_TEMPLATES[tier](clean, total);

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

  // Caveats, fixed order, each only when its condition holds and its inputs exist.
  const caveats: WeatherCaveat[] = [];
  const stripYears = num(r.strip_years_used);

  // 1. Severe rain (strip span). The row stores a count only, not which years.
  const severe = num(r.severe_rain_warning_years);
  const thresholdMm = num(r.severe_rain_threshold_mm);
  if (severe !== null && thresholdMm !== null && stripYears !== null && severe >= T.severeRainCaveatMinYears) {
    caveats.push({
      kind: 'severe_rain',
      text:
        `Severe rain has happened in this window in ${severe} of the last ${stripYears} ${yearsWord(stripYears)} ` +
        `(a day with more than ${formatMm(thresholdMm)} mm of daytime rain).`,
    });
  }

  // 2. Back-to-back washouts (strip span).
  const backToBack = num(r.consecutive_washout_years);
  if (backToBack !== null && stripYears !== null && backToBack >= T.backToBackWashoutCaveatMinYears) {
    caveats.push({
      kind: 'back_to_back_washouts',
      text: `Two washout days in a row happened in ${backToBack} of the last ${stripYears} ${yearsWord(stripYears)}.`,
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

  return { tier, headline, warmth, caveats };
}
