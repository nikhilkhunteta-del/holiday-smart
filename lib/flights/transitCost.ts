// Transit cost utility for the all-in flight cost calculation (Feature 3).
// Given a postcode district, departure airport, flight departure time, and family
// composition, returns a structured transit cost object comparing public transport
// vs Uber, with a recommendation.
//
// All fare data sourced from district_airport_transit table keyed by
// postcode_district × airport_code. Child fares are computed here at serve time.

// ── Config constants ──────────────────────────────────────────────────────────

const EARLY_FLIGHT_HOUR = 7;
const EARLY_SURGE_HOUR = 6;
const UBER_XL_MULTIPLIER = 1.5;
const UBER_XL_THRESHOLD = 5;           // people
const UBER_TRANSIT_THRESHOLD_PENCE = 5000;  // £50
const MIN_CHANGES_FOR_UBER = 2;
const TIME_DELTA_THRESHOLD_MINS = 30;

const TFL_CHILD_PEAK_PENCE = 105;
const TFL_CHILD_OFFPEAK_PENCE = 95;

// ── Types ─────────────────────────────────────────────────────────────────────

export type TransitCostInput = {
  postcode_district: string;
  airport_iata: string;
  departure_time: Date;
  adults: number;
  children: { age: number }[];
  infants: number;
  checkedBags?: number;
};

export type AirportTransitCost = {
  airport_iata: string;

  transit: {
    total_family_pence: number;
    duration_mins: number;
    changes: number;
    route_summary: string;
    confidence: 'ok' | 'estimated';
    early_flight_warning: boolean;
    fare_unavailable: boolean;
  } | null;                           // null if no row in district_airport_transit

  uber: {
    low_pence: number;                // XL-adjusted if family >= 4
    high_pence: number;               // XL-adjusted if family >= 4
    mean_pence: number;               // (low + high) / 2
    is_xl: boolean;
    duration_mins: number;
    early_morning_surge_warning: boolean;  // departure before 06:00
  };

  recommended_mode: 'transit' | 'uber';
  recommended_cost_pence: number;
  time_delta_mins: number;            // uber_duration - transit_duration (negative = uber faster)
  show_time_delta: boolean;           // true if abs(time_delta) >= 30 min
};

// ── Internal DB row shape ─────────────────────────────────────────────────────

export interface TransitRow {
  transit_offpeak_fare_pence: number | null;
  transit_offpeak_duration_mins: number | null;
  transit_offpeak_route_summary: string | null;
  transit_changes: number | null;
  uber_low_pence: number | null;
  uber_high_pence: number | null;
  uber_duration_offpeak_mins: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function isTflPeak(dt: Date): boolean {
  const day = dt.getDay();   // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const mins = dt.getHours() * 60 + dt.getMinutes();
  return (mins >= 390 && mins <= 570) ||    // 06:30–09:30
         (mins >= 960 && mins <= 1140);     // 16:00–19:00
}

type RouteType = 'tfl' | 'nr' | 'ne_coach' | 'flibco';

// Keyword check order: NE Coach before NR to avoid 'National' ambiguity.
function detectRouteType(summary: string): RouteType {
  if (/national express/i.test(summary)) return 'ne_coach';
  if (/flibco/i.test(summary)) return 'flibco';
  if (/stansted express|thameslink|southern|great northern|national rail/i.test(summary)) return 'nr';
  return 'tfl';
}

function childFarePence(
  age: number,
  adultFarePence: number,
  routeType: RouteType,
  isPeak: boolean,
): number {
  switch (routeType) {
    case 'tfl':
      if (age < 5) return 0;
      if (age < 16) return isPeak ? TFL_CHILD_PEAK_PENCE : TFL_CHILD_OFFPEAK_PENCE;
      return adultFarePence;

    case 'nr':
      if (age < 5) return 0;
      if (age < 16) return Math.round(adultFarePence * 0.5);
      return adultFarePence;

    case 'ne_coach':
      if (age < 3) return 0;
      if (age < 16) return Math.round(adultFarePence * 0.75);
      return adultFarePence;

    case 'flibco':
      if (age < 3) return 0;
      if (age < 16) return Math.round(adultFarePence * 0.5);
      return adultFarePence;
  }
}

// ── Pure computation (exported for unit tests) ────────────────────────────────

export function computeTransitCost(
  input: TransitCostInput,
  row: TransitRow | null,
): AirportTransitCost {
  const { airport_iata, departure_time, adults, children, infants } = input;

  const hourOfDep = departure_time.getHours();
  const earlyFlight = hourOfDep < EARLY_FLIGHT_HOUR;
  const earlySurge = hourOfDep < EARLY_SURGE_HOUR;

  // ── Uber (XL-adjusted) ──────────────────────────────────────────────────────
  const totalPeople = adults + children.length + infants;
  const isXL = totalPeople >= UBER_XL_THRESHOLD ||
               (input.checkedBags ?? 0) >= 2;
  const xlMult = isXL ? UBER_XL_MULTIPLIER : 1;
  const uberLow = Math.round((row?.uber_low_pence ?? 0) * xlMult);
  const uberHigh = Math.round((row?.uber_high_pence ?? 0) * xlMult);
  const uberMean = Math.round((uberLow + uberHigh) / 2);
  const uberDuration = row?.uber_duration_offpeak_mins ?? 0;

  // ── Transit ─────────────────────────────────────────────────────────────────
  const fareUnavailable = row === null || row.transit_offpeak_fare_pence === null;
  const adultFare = row?.transit_offpeak_fare_pence ?? 0;
  const transitDuration = row?.transit_offpeak_duration_mins ?? 0;
  const transitChanges = row?.transit_changes ?? 0;
  const routeSummary = row?.transit_offpeak_route_summary ?? '';

  let transitTotal = 0;
  if (!fareUnavailable) {
    const routeType = detectRouteType(routeSummary);
    const isPeak = isTflPeak(departure_time);
    transitTotal =
      adults * adultFare +
      children.reduce((sum, c) => sum + childFarePence(c.age, adultFare, routeType, isPeak), 0);
  }

  const transit =
    row === null
      ? null
      : {
          total_family_pence: transitTotal,
          duration_mins: transitDuration,
          changes: transitChanges,
          route_summary: routeSummary,
          confidence: (fareUnavailable ? 'estimated' : 'ok') as 'ok' | 'estimated',
          early_flight_warning: earlyFlight,
          fare_unavailable: fareUnavailable,
        };

  // ── Recommendation: first matching rule wins ────────────────────────────────

  let recommended_mode: 'transit' | 'uber';
  let recommended_cost_pence: number;

  if (earlyFlight) {
    // Rule 1: departure before 07:00 → uber, use high estimate
    recommended_mode = 'uber';
    recommended_cost_pence = uberHigh;
  } else if (fareUnavailable) {
    // Rule 2: no transit fare data → uber, use mean estimate
    recommended_mode = 'uber';
    recommended_cost_pence = uberMean;
  } else if (
    transitChanges >= MIN_CHANGES_FOR_UBER &&
    uberMean - transitTotal <= UBER_TRANSIT_THRESHOLD_PENCE
  ) {
    // Rule 3: ≥2 changes AND uber is within £50 of transit → uber (less hassle)
    recommended_mode = 'uber';
    recommended_cost_pence = uberMean;
  } else {
    // Rule 4: default → transit
    recommended_mode = 'transit';
    recommended_cost_pence = transitTotal;
  }

  // ── Time delta ──────────────────────────────────────────────────────────────
  const time_delta_mins = uberDuration - transitDuration;
  const show_time_delta = Math.abs(time_delta_mins) >= TIME_DELTA_THRESHOLD_MINS;

  return {
    airport_iata,
    transit,
    uber: {
      low_pence: uberLow,
      high_pence: uberHigh,
      mean_pence: uberMean,
      is_xl: isXL,
      duration_mins: uberDuration,
      early_morning_surge_warning: earlySurge,
    },
    recommended_mode,
    recommended_cost_pence,
    time_delta_mins,
    show_time_delta,
  };
}

// ── Supabase lookup ───────────────────────────────────────────────────────────

// Dynamic import so tests can import this module without Supabase env vars set.
// The server client is only initialised when getTransitCost() is actually called.
async function fetchTransitRow(
  postcode_district: string,
  airport_iata: string,
): Promise<TransitRow | null> {
  const { supabaseServer } = await import('../supabase-server');

  const { data, error } = await supabaseServer
    .from('district_airport_transit')
    .select(
      'transit_offpeak_fare_pence, transit_offpeak_duration_mins, transit_offpeak_route_summary, transit_changes, uber_low_pence, uber_high_pence, uber_duration_offpeak_mins',
    )
    .eq('postcode_district', postcode_district)
    .eq('airport_code', airport_iata)
    .maybeSingle();

  if (error) throw error;
  return data as TransitRow | null;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getTransitCost(input: TransitCostInput): Promise<AirportTransitCost> {
  const row = await fetchTransitRow(input.postcode_district, input.airport_iata);
  return computeTransitCost(input, row);
}
