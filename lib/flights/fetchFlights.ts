const BASE_URL = 'https://www.searchapi.io/api/v1/search';

// ── Input params ──────────────────────────────────────────────────────────────

export interface FlightSearchParams {
  origin: string;        // IATA code, e.g. 'LGW'
  destination: string;   // IATA code, e.g. 'BCN'
  outboundDate: string;  // YYYY-MM-DD
  returnDate?: string;   // YYYY-MM-DD — omit for one-way (standard path)
  adults?: number;
  children?: number;
  currency?: string;     // default 'GBP'
}

export interface CalendarLegParams {
  // Accepts comma-separated IATA codes for multi-airport queries,
  // e.g. origin='LGW,LHR,STN,LTN,LCY', destination='BCN'
  origin: string;
  destination: string;
  dateStart: string;  // YYYY-MM-DD — start of date range to query
  dateEnd: string;    // YYYY-MM-DD — end of date range to query
  currency?: string;  // default 'GBP'
}

// ── Raw SearchAPI.io types (google_flights engine) ────────────────────────────

interface RawFlightLeg {
  departure_airport: { id: string; name: string; time: string };
  arrival_airport: { id: string; name: string; time: string };
  airline: string;
  flight_number: string;
  duration: number; // minutes
}

interface RawFlight {
  booking_token: string;
  price: number;
  flights: RawFlightLeg[];
  total_duration: number; // minutes
  layovers?: { id: string; duration: number; overnight: boolean }[];
}

interface SearchAPIFlightsResponse {
  best_flights?: RawFlight[];
  other_flights?: RawFlight[];
  error?: string;
}

// ── Normalised output types ───────────────────────────────────────────────────

export interface FlightResult {
  bookingToken: string;
  price: number;         // party total in requested currency
  carrier: string;       // airline name, e.g. 'Vueling'
  airlineIata: string;   // 2-letter IATA code, e.g. 'VY'
  flightNumber: string;  // e.g. 'VY 7827'
  origin: string;        // departure airport IATA
  destination: string;   // arrival airport IATA
  departureTime: string; // as returned by API — may be full datetime
  arrivalTime: string;   // as returned by API — may be full datetime
  durationMinutes: number;
  stopCount: number;
  layovers: { airport: string; durationMinutes: number; overnight: boolean }[];
  isBestFlight: boolean; // true = best_flights bucket; false = other_flights
  rawJson: unknown;      // full RawFlight object — never lose an unparsed field
}

export interface CalendarLeg {
  date: string;             // YYYY-MM-DD (from 'departure' field in API response)
  price: number | null;     // null when no flights available on that date
  currency: string;
  isLowestPrice?: boolean;  // true when API flags this as the cheapest date in range
}

// ── Internal helpers ──────────────────────────────────────────────────────────

// Extract 2-letter IATA airline code from flight number ('VY 7827' → 'VY', 'U2 8271' → 'U2')
function extractAirlineIata(flightNumber: string): string {
  const match = flightNumber.replace(/\s+/g, '').match(/^([A-Z0-9]{2})/i);
  return match ? match[1].toUpperCase() : flightNumber.slice(0, 2).toUpperCase();
}

function buildFlightParams(
  params: FlightSearchParams,
): Record<string, string | number> {
  const isRoundTrip = !!params.returnDate;
  return {
    engine: 'google_flights',
    api_key: process.env.SEARCHAPI_KEY ?? '',
    departure_id: params.origin,
    arrival_id: params.destination,
    outbound_date: params.outboundDate,
    ...(isRoundTrip ? { return_date: params.returnDate as string } : {}),
    flight_type: isRoundTrip ? 'round_trip' : 'one_way',
    adults: params.adults ?? 1,
    children: params.children ?? 0,
    currency: params.currency ?? 'GBP',
    gl: 'gb',
    hl: 'en',
    max_flight_duration: 360,
  };
}

function normalise(raw: SearchAPIFlightsResponse): FlightResult[] {
  const results: FlightResult[] = [];

  const addGroup = (flights: RawFlight[] | undefined, isBest: boolean) => {
    for (const f of flights ?? []) {
      const first = f.flights[0];
      const last = f.flights[f.flights.length - 1];
      if (!first || !last) continue;
      results.push({
        bookingToken: f.booking_token,
        price: f.price,
        carrier: first.airline,
        airlineIata: extractAirlineIata(first.flight_number),
        flightNumber: first.flight_number,
        origin: first.departure_airport.id,
        destination: last.arrival_airport.id,
        departureTime: first.departure_airport.time,
        arrivalTime: last.arrival_airport.time,
        durationMinutes: f.total_duration,
        stopCount: f.flights.length - 1,
        layovers: (f.layovers ?? []).map(l => ({
          airport: l.id,
          durationMinutes: l.duration,
          overnight: l.overnight,
        })),
        isBestFlight: isBest,
        rawJson: f,
      });
    }
  };

  addGroup(raw.best_flights, true);
  addGroup(raw.other_flights, false);
  return results;
}

async function searchAPIFetch<T>(url: URL): Promise<T> {
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`SearchAPI.io ${res.status}: ${res.statusText} — ${url.pathname}`);
  }
  const data = (await res.json()) as T & { error?: string };
  if (data.error) throw new Error(`SearchAPI.io error: ${data.error}`);
  return data;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Search for flights (one-way or round-trip).
 * Standard path: omit returnDate — one-way, booking_token returned directly.
 * Round-trip: pass returnDate — for ROUND_TRIP_ELIGIBLE_CARRIERS (BA, TP) only.
 */
export async function fetchFlights(
  params: FlightSearchParams,
): Promise<FlightResult[]> {
  const url = new URL(BASE_URL);
  for (const [k, v] of Object.entries(buildFlightParams(params))) {
    url.searchParams.set(k, String(v));
  }
  const data = await searchAPIFetch<SearchAPIFlightsResponse>(url);
  return normalise(data);
}

/**
 * Stage 1 calendar pre-filter (google_flights_calendar engine).
 *
 * Returns one entry per day in the date range with the cheapest one-way price
 * across all queried airport combinations. Results are used in-memory only to
 * identify promising dates for Stage 2 detail calls — never written to a table.
 *
 * Both origin and destination accept comma-separated IATA codes for
 * multi-airport queries, e.g. origin='LGW,LHR,STN,LTN,LCY', destination='BCN'.
 */
export async function fetchCalendarLegs(
  params: CalendarLegParams,
): Promise<CalendarLeg[]> {
  const url = new URL(BASE_URL);
  url.searchParams.set('engine', 'google_flights_calendar');
  url.searchParams.set('api_key', process.env.SEARCHAPI_KEY ?? '');
  url.searchParams.set('departure_id', params.origin);
  url.searchParams.set('arrival_id', params.destination);
  url.searchParams.set('outbound_date_start', params.dateStart);
  url.searchParams.set('outbound_date_end', params.dateEnd);
  url.searchParams.set('flight_type', 'one_way');
  url.searchParams.set('currency', params.currency ?? 'GBP');
  url.searchParams.set('gl', 'gb');
  url.searchParams.set('hl', 'en');

  const data = await searchAPIFetch<{
    calendar?: { departure: string; price: number | null; is_lowest_price?: boolean }[];
  }>(url);

  return (data.calendar ?? []).map(d => ({
    date: d.departure,
    price: d.price,
    currency: params.currency ?? 'GBP',
    isLowestPrice: d.is_lowest_price,
  }));
}
