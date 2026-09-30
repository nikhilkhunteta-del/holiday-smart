/**
 * Turns Open-Meteo archive/marine responses fetched with `timezone=UTC` into
 * the rows weather_snapshots / weather_daily_context store, with every local
 * date, hour, sunrise/sunset and is_daylight computed from the UTC instants
 * via the destination's IANA zone (see localTime.ts). Pure — no I/O.
 */

import { formatHHMM, parseUtcIso, toLocalParts } from './localTime';

export interface UtcArchive {
  hourly: {
    time: string[];
    precipitation: number[];
    temperature_2m: (number | null)[];
    apparent_temperature: (number | null)[];
    cloud_cover: (number | null)[];
    wind_speed_10m: (number | null)[];
    weather_code: (number | null)[];
  };
  daily: { time: string[]; sunrise: string[]; sunset: string[] };
}

export interface UtcMarine {
  hourly: { time: string[]; sea_surface_temperature: (number | null)[] };
}

export interface LocalHourlyRow {
  observed_date: string;
  observed_hour: number;
  precipitation_mm: number;
  temperature_c: number | null;
  apparent_temperature_c: number | null;
  cloud_cover_pct: number | null;
  wind_speed_kmh: number | null;
  weather_code: number | null;
  is_daylight: boolean;
  raw_json: Record<string, unknown>;
}

export interface LocalDailyRow {
  observed_date: string;
  sunrise_local: string;
  sunset_local: string;
  sea_surface_temp_c: number | null;
}

export interface LocalizedArchive {
  hourly: LocalHourlyRow[];
  daily: LocalDailyRow[];
  /** Local hours dropped because the wall clock repeated them (DST fall-back). */
  repeatedHoursDropped: number;
}

/**
 * @param localStart/localEnd inclusive LOCAL calendar range to keep, YYYY-MM-DD.
 *   The UTC fetch is padded by a day each side so every local day in range is complete.
 * @param seaTempLocalHour local hour whose marine reading represents the day.
 */
export function localizeArchive(
  archive: UtcArchive,
  marine: UtcMarine | null,
  timeZone: string,
  localStart: string,
  localEnd: string,
  seaTempLocalHour: number,
): LocalizedArchive {
  const inRange = (d: string) => d >= localStart && d <= localEnd;

  // Daylight intervals as instants: an hour is daylight iff its start instant lies in [sunrise, sunset).
  const intervals = archive.daily.time.flatMap((_, i) => {
    const sr = archive.daily.sunrise[i];
    const ss = archive.daily.sunset[i];
    return sr && ss ? [{ sunrise: parseUtcIso(sr), sunset: parseUtcIso(ss) }] : [];
  });

  // ── hourly ────────────────────────────────────────────────────────────────
  // The local clock repeats one hour at DST fall-back (two distinct instants
  // share 'YYYY-MM-DD hour'), but the table's key is (destination, date, hour).
  // The FIRST (earlier-instant) occurrence is kept and the repeat dropped; the
  // count is reported so it is never silent.
  const hourly: LocalHourlyRow[] = [];
  const seen = new Set<string>();
  let repeatedHoursDropped = 0;
  const h = archive.hourly;
  h.time.forEach((t, i) => {
    const ms = parseUtcIso(t);
    const p = toLocalParts(ms, timeZone);
    if (!inRange(p.date)) return;
    if (p.minute !== 0) {
      throw new Error(`${timeZone}: hourly instant ${t}Z maps to local minute ${p.minute} — half-hour zones unsupported`);
    }
    const key = `${p.date}|${p.hour}`;
    if (seen.has(key)) {
      repeatedHoursDropped++;
      return;
    }
    seen.add(key);
    hourly.push({
      observed_date: p.date,
      observed_hour: p.hour,
      precipitation_mm: h.precipitation[i] ?? 0,
      temperature_c: h.temperature_2m[i],
      apparent_temperature_c: h.apparent_temperature[i],
      cloud_cover_pct: h.cloud_cover[i],
      wind_speed_kmh: h.wind_speed_10m[i],
      weather_code: h.weather_code[i],
      is_daylight: intervals.some(iv => ms >= iv.sunrise && ms < iv.sunset),
      // Synthesised per-hour object (Open-Meteo's wire format is columnar), now carrying
      // both the authoritative UTC instant and the derived local label.
      raw_json: {
        time_utc: `${t}Z`,
        time_local: `${p.date}T${String(p.hour).padStart(2, '0')}:00`,
        timezone: timeZone,
        precipitation: h.precipitation[i],
        temperature_2m: h.temperature_2m[i],
        apparent_temperature: h.apparent_temperature[i],
        cloud_cover: h.cloud_cover[i],
        wind_speed_10m: h.wind_speed_10m[i],
        weather_code: h.weather_code[i],
      },
    });
  });

  // ── marine: local date -> reading at the representative local hour ─────────
  const seaByDate = new Map<string, number | null>();
  if (marine) {
    const seen2 = new Set<string>();
    marine.hourly.time.forEach((t, i) => {
      const p = toLocalParts(parseUtcIso(t), timeZone);
      const key = `${p.date}|${p.hour}`;
      if (seen2.has(key)) return;
      seen2.add(key);
      if (p.hour === seaTempLocalHour) seaByDate.set(p.date, marine.hourly.sea_surface_temperature[i] ?? null);
    });
  }

  // ── daily ─────────────────────────────────────────────────────────────────
  const daily: LocalDailyRow[] = [];
  archive.daily.time.forEach((_, i) => {
    const sr = archive.daily.sunrise[i];
    const ss = archive.daily.sunset[i];
    if (!sr || !ss) return;
    const rise = toLocalParts(parseUtcIso(sr), timeZone);
    const set = toLocalParts(parseUtcIso(ss), timeZone);
    if (!inRange(rise.date)) return; // the day is named by its sunrise's local date
    daily.push({
      observed_date: rise.date,
      sunrise_local: formatHHMM(rise),
      sunset_local: formatHHMM(set),
      sea_surface_temp_c: seaByDate.get(rise.date) ?? null,
    });
  });

  return { hourly, daily, repeatedHoursDropped };
}
