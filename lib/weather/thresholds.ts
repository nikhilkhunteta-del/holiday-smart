export const WEATHER_THRESHOLDS = {
  meaningfulRainHourMm: 0.5, // hourly precip below this is grid noise, not rain
  washoutDayRainHours: 3, // >= this many meaningful-rain hours in daylight = washout
  washoutDayTotalMm: 8, // OR >= this much daylight precip total = washout
  usableDayMaxRainHours: 1, // a usable day tolerates at most this many meaningful-rain hours
  usableDayMinFeelsLikeC: 15, // a usable day needs at least this feels-like temperature
  usableDayMinDaylightHoursAtTemp: 6, // and needs at least this many daylight hours at/above that temperature
  // Severe rain (SEASONAL definition, not annual): a day is "severe" when its total daylight
  // precipitation is strictly above this percentile of that destination's WET days. The pool is
  // every ingested raw day across the strip years — currently only ~15 Oct to 5 Nov each year,
  // NOT the whole year — so the threshold describes late-October rain, not climate-wide extremes.
  // Linear-interpolation percentile (same as Postgres PERCENTILE_CONT).
  severeRainPercentile: 95,
  severeRainMinMm: 20, // floor: effective severe threshold = max(percentile value, this), so a destination's own p95 can never fall below it
  wetDayMinMm: 1, // a "wet day" has >= this much total daylight precipitation; defines the severe-rain pool
  seaTempSwimmableC: 20, // sea temperature at/above this is considered swimmable
  headlineYearSpan: 10, // years used for the verdict headline
  stripYearSpan: 20, // years used for the full year-by-year strip
  // ── Verdict (computeWeatherVerdict.ts) ──
  // Tier = headline_clean_year_count: how many of the headlineYearSpan years had at most one
  // washout day in the window. Each value is the MINIMUM clean-year count for that tier.
  verdictReliableMinCleanYears: 8, // 8-10 -> reliable
  verdictMostlyFineMinCleanYears: 6, // 6-7 -> mostly_fine
  verdictMixedMinCleanYears: 4, // 4-5 -> mixed; anything below -> unreliable (0-3)
  // Warmth band from the MIDPOINT of the daytime feels-like range (P10..P90, headline years).
  // Each value is the minimum midpoint for that band; below warmthMildMinC -> cool.
  warmthMildMinC: 15, // same figure as usableDayMinFeelsLikeC: below it the typical day is under the "usable day" bar
  warmthWarmMinC: 19, // t-shirt days most of the time
  warmthHotMinC: 24, // midday heat worth planning around
  // Back-to-back washout caveat shows when consecutive_washout_years (strip span) reaches this.
  // Raised from 3: at 3 it fired for every pilot destination, including ones whose headline says
  // nine years in ten were fine, which read as a contradiction rather than a useful warning.
  backToBackWashoutCaveatMinYears: 5,
  // Severe-rain caveat shows when severe_rain_warning_years (strip span) reaches this.
  severeRainCaveatMinYears: 1,
} as const;
