export const WEATHER_THRESHOLDS = {
  meaningfulRainHourMm: 0.5, // hourly precip below this is grid noise, not rain
  washoutDayRainHours: 3, // >= this many meaningful-rain hours in daylight = washout
  washoutDayTotalMm: 8, // OR >= this much daylight precip total = washout
  usableDayMaxRainHours: 1, // a usable day tolerates at most this many meaningful-rain hours
  usableDayMinFeelsLikeC: 15, // a usable day needs at least this feels-like temperature
  usableDayMinDaylightHoursAtTemp: 6, // and needs at least this many daylight hours at/above that temperature
  seaTempSwimmableC: 20, // sea temperature at/above this is considered swimmable
  headlineYearSpan: 10, // years used for the verdict headline
  stripYearSpan: 20, // years used for the full year-by-year strip
} as const;
