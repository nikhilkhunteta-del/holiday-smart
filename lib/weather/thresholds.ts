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
  // Sea card sentence, chosen from the unrounded sea_temp_c: at/above seaTempComfortableC
  // "Comfortable for swimming.", at/above seaTempSwimmableC "Cool but swimmable.", below it
  // "Cold for most swimmers."
  seaTempComfortableC: 22,
  seaTempSwimmableC: 20,
  headlineYearSpan: 10, // years used for the verdict headline
  stripYearSpan: 20, // years used for the full year-by-year strip
  // ── Verdict (computeWeatherVerdict.ts) ──
  // Tier = headline_clean_year_count: how many of the headlineYearSpan years had at most one
  // washout day in the window. Each value is the MINIMUM clean-year count for that tier.
  verdictReliableMinCleanYears: 8, // 8-10 -> reliable
  verdictMostlyFineMinCleanYears: 6, // 6-7 -> mostly_fine
  verdictMixedMinCleanYears: 4, // 4-5 -> mixed; anything below -> unreliable (0-3)
  // Rain timing: "Mornings are usually dry" is only claimed when at least this share (%) of
  // meaningful-rain daylight hours fell at or after 14:00 (pct_daylight_rain_after_2pm, all strip
  // years). Daylight runs roughly 08:00-19:00 in late October, so after-2pm is about half the
  // daylight hours: rain spread evenly lands near 50% there. 65 asks for a clear tilt (about two
  // rain hours in three after 2pm) before saying mornings are dry. Below it the copy is neutral.
  rainTimingLateDayMinPct: 65,
} as const;
