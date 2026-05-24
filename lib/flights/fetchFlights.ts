// Crawlio Google Flights adapter (google-flights8 on RapidAPI).
// ONLY import point for flight data in the TypeScript codebase.
// Never call RapidAPI directly from components, jobs, or any other file.

const RAPIDAPI_HOST = 'google-flights8.p.rapidapi.com';
const BASE_URL = `https://${RAPIDAPI_HOST}/`;

// ── Input ─────────────────────────────────────────────────────────────────────

export interface FlightSearchParams {
  origin: string;       // IATA code or city code. Use 'LON' for all London airports.
  destination: string;  // IATA code, e.g. 'BCN'
  date: string;         // YYYY-MM-DD
  adults?: number;      // default 2
  children?: number;    // default 0
  infants?: number;     // default 0 (lap infants — maps to infants_on_lap in Crawlio)
}

// ── Crawlio raw response types ────────────────────────────────────────────────

interface CrawlioSegment {
  from: string;
  to: string;
  departure: string | null;    // ISO 8601 datetime — null on some codeshares
  arrival: string | null;      // ISO 8601 datetime — null on some codeshares
  plane: string | null;        // aircraft type, e.g. 'Airbus A320'
  airline: string | null;      // airline name (for raw_json only — not stored as a column)
  flight_number: string | null;
}

interface CrawlioResult {
  price: number;               // integer GBP party total — use directly as party_total_gbp
  duration_min: number;        // total journey time in minutes
  stops: number;               // 0 = direct
  segments: CrawlioSegment[];
}

interface CrawlioFlight {
  is_best: boolean;
  url: string;                 // contains tfu query param — source of booking_token and airline_iata
}

interface CrawlioResponse {
  flights: CrawlioFlight[];
  results: CrawlioResult[];
}

// ── Output — fare_snapshots-shaped ───────────────────────────────────────────
//
// Excludes fields set by the caller:
//   run_id, snapshot_type, departure_date, observed_at (DB DEFAULT now())
//
// Required schema migrations before first insert:
//   ALTER TABLE fare_snapshots ALTER COLUMN flight_number DROP NOT NULL;
//   ALTER TABLE fare_snapshots ADD COLUMN IF NOT EXISTS aircraft_type text;
//   ALTER TABLE fare_snapshots DROP COLUMN IF EXISTS price_level;
//   ALTER TABLE fare_snapshots DROP COLUMN IF EXISTS typical_price_low_gbp;
//   ALTER TABLE fare_snapshots DROP COLUMN IF EXISTS typical_price_high_gbp;

export interface FlightRow {
  origin_iata: string;
  destination_iata: string;
  flight_number: null;           // Crawlio does not return flight numbers
  airline_iata: string | null;   // decoded from tfu param; null if decode fails
  departure_time: string | null; // HH:MM — null on some codeshare segments
  arrival_time: string | null;   // HH:MM — null on some codeshare segments
  duration_minutes: number;
  stops: number;
  aircraft_type: string | null;
  is_overnight: boolean;
  adults: number;
  children: number;
  infants: number;
  party_total_gbp: number;
  booking_token: string | null;  // raw tfu param value (expires ~30 min)
  result_bucket: 'best' | 'other';
  result_rank: number;
  raw_json: unknown;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Base64-decode the tfu URL param to find the IATA airline prefix.
// e.g. tfu=EgZGUjc4MDc → decoded bytes contain 'FR7807' → returns 'FR'
function extractAirlineIata(flightUrl: string): string | null {
  try {
    const tfu = new URL(flightUrl).searchParams.get('tfu');
    if (!tfu) return null;
    // Add padding so Buffer.from doesn't choke on unpadded base64
    const padded = tfu + '==='.slice(0, (4 - (tfu.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('latin1');
    const match = decoded.match(/([A-Z][A-Z0-9])\d{2,5}/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function extractBookingToken(flightUrl: string): string | null {
  try {
    return new URL(flightUrl).searchParams.get('tfu');
  } catch {
    return null;
  }
}

// Extract HH:MM from ISO datetime string ('2026-10-26T07:15:00' or '2026-10-26 07:15').
function toHHMM(iso: string | null): string | null {
  if (!iso) return null;
  const parts = iso.trim().split(/[\sT]/);
  const time = parts[parts.length - 1].slice(0, 5);
  return time.length === 5 ? time : null;
}

function detectOvernight(dep: string | null, arr: string | null): boolean {
  if (!dep || !arr) return false;
  const d = dep.trim().split(/[\sT]/);
  const a = arr.trim().split(/[\sT]/);
  return d.length >= 2 && a.length >= 2 && d[0] !== a[0];
}

function normalise(response: CrawlioResponse, params: FlightSearchParams): FlightRow[] {
  const rows: FlightRow[] = [];
  let bestRank = 1;
  let otherRank = 1;

  const len = Math.min(response.flights.length, response.results.length);

  for (let i = 0; i < len; i++) {
    const flight = response.flights[i];
    const result = response.results[i];
    if (!flight || !result) continue;

    const seg = result.segments?.[0];
    const isBest = flight.is_best;

    rows.push({
      origin_iata:      (seg?.from ?? params.origin).slice(0, 3),
      destination_iata: (seg?.to   ?? params.destination).slice(0, 3),
      flight_number:    null,
      airline_iata:     extractAirlineIata(flight.url),
      departure_time:   toHHMM(seg?.departure ?? null),
      arrival_time:     toHHMM(seg?.arrival   ?? null),
      duration_minutes: result.duration_min,
      stops:            result.stops,
      aircraft_type:    seg?.plane ?? null,
      is_overnight:     detectOvernight(seg?.departure ?? null, seg?.arrival ?? null),
      adults:           params.adults   ?? 2,
      children:         params.children ?? 0,
      infants:          params.infants  ?? 0,
      party_total_gbp:  result.price,
      booking_token:    extractBookingToken(flight.url),
      result_bucket:    isBest ? 'best' : 'other',
      result_rank:      isBest ? bestRank++ : otherRank++,
      raw_json:         { flight, result },
    });
  }

  return rows;
}

async function crawlioFetch(queryParams: Record<string, string | number>): Promise<CrawlioResponse> {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) throw new Error('RAPIDAPI_KEY env var is not set');

  const url = new URL(BASE_URL);
  for (const [k, v] of Object.entries(queryParams)) {
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    headers: {
      'X-RapidAPI-Key':  key,
      'X-RapidAPI-Host': RAPIDAPI_HOST,
    },
  });

  if (!res.ok) {
    throw new Error(`Crawlio ${res.status}: ${res.statusText}`);
  }

  const data = (await res.json()) as CrawlioResponse & { message?: string };
  if (data.message) throw new Error(`Crawlio API: ${data.message}`);
  return data;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch one-way flights via Crawlio (google-flights8 on RapidAPI).
 * Results are sorted by price (sort_by=1), not Google's default 'best' ranking.
 *
 * Returns FlightRow[] shaped for fare_snapshots INSERT.
 * Caller must add: run_id, snapshot_type, departure_date.
 * observed_at is handled by the DB DEFAULT.
 *
 * This is the ONLY function in the TypeScript codebase that contacts RapidAPI.
 */
export async function fetchFlights(params: FlightSearchParams): Promise<FlightRow[]> {
  const response = await crawlioFetch({
    departure_id:   params.origin,
    arrival_id:     params.destination,
    outbound_date:  params.date,
    type:           2,                   // 2 = one-way; 1 = round-trip
    adults:         params.adults   ?? 2,
    children:       params.children ?? 0,
    infants_on_lap: params.infants  ?? 0,
    currency:       'GBP',
    hl:             'en',
    sort_by:        1,                   // price ascending; omit for Google default 'best'
  });

  return normalise(response, params);
}
