const BASE_URL = 'https://www.searchapi.io/api/v1/search';

// ── Input params ──────────────────────────────────────────────────────────────

export interface FlightSearchParams {
  origin: string;        // IATA code, e.g. 'LHR'
  destination: string;   // IATA code, e.g. 'BCN'
  outboundDate: string;  // YYYY-MM-DD
  returnDate?: string;   // YYYY-MM-DD — omit for one-way
  adults?: number;
  children?: number;
  currency?: string;     // default 'GBP'
}

export interface CalendarLegParams {
  origin: string;
  destination: string;
  year: number;
  month: number; // 1–12
  currency?: string;
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
  price: number; // per person in requested currency
  carrier: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departureTime: string;
  arrivalTime: string;
  durationMinutes: number;
  stopCount: number;
  layovers: { airport: string; durationMinutes: number; overnight: boolean }[];
  isBestFlight: boolean;
}

export interface CalendarLeg {
  date: string;         // YYYY-MM-DD
  price: number | null; // null when no flights that day
  currency: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

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
    gl: 'uk',
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
 * Search for flights. Pass returnDate for round-trip; omit for one-way.
 * One-way results carry a booking_token directly — no departure_token chain.
 */
export async function fetchFlights(
  params: FlightSearchParams,
): Promise<FlightResult[]> {
  const url = new URL(BASE_URL);
  const queryParams = buildFlightParams(params);
  for (const [k, v] of Object.entries(queryParams)) {
    url.searchParams.set(k, String(v));
  }
  const data = await searchAPIFetch<SearchAPIFlightsResponse>(url);
  return normalise(data);
}

/**
 * Fetch day-by-day pricing for a given month using the google_flights_calendar
 * engine. Useful for the Compliance Calculator and calendar heat-maps.
 */
export async function fetchCalendarLegs(
  params: CalendarLegParams,
): Promise<CalendarLeg[]> {
  const url = new URL(BASE_URL);
  url.searchParams.set('engine', 'google_flights_calendar');
  url.searchParams.set('api_key', process.env.SEARCHAPI_KEY ?? '');
  url.searchParams.set('departure_id', params.origin);
  url.searchParams.set('arrival_id', params.destination);
  url.searchParams.set('year', String(params.year));
  url.searchParams.set('month', String(params.month));
  url.searchParams.set('currency', params.currency ?? 'GBP');
  url.searchParams.set('gl', 'uk');
  url.searchParams.set('hl', 'en');

  const data = await searchAPIFetch<{
    days?: { day: string; price: number | null }[];
  }>(url);

  return (data.days ?? []).map(d => ({
    date: d.day,
    price: d.price,
    currency: params.currency ?? 'GBP',
  }));
}
