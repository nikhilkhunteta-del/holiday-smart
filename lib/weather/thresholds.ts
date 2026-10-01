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
} as const;
