// ── Party composition (set via TravellerBanner before results render) ────────
export interface Party {
  adults: number;
  children: number;
  childAges: number[]; // length === children, values 0–17
}

// ── Search context (passed from landing page via query params) ─────────────
export interface SearchContext {
  school: string;
  urn: string;
  borough: string;
  breakLabel: string;
  startDate: string; // ISO date
  endDate: string;   // ISO date
}

// ── Section 1: Inset + School Calendar Engine ──────────────────────────────
export interface CalendarWindow {
  label: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  type: 'official' | 'extended-pre' | 'extended-post' | 'inset-stretch';
}

export interface SchoolCalendarData {
  schoolName: string;
  borough: string;
  breakLabel: string;
  officialStart: string;
  officialEnd: string;
  officialDays: number;
  insetDays: { date: string; label: string }[];
  londonAverageStartDate: string;
  londonAverageEndDate: string;
  percentileEarlier: number; // % of schools that break later
  stretchWindows: CalendarWindow[];
  adjacentWeekend: { before: boolean; after: boolean };
}

// ── Section 2: Compliance Calculus Calculator ──────────────────────────────
export interface ComplianceScenario {
  label: string;
  daysEarly: number;
  departureDate: string;
  returnDate: string;
  flightCost: number;      // family total
  officialFlightCost: number;
  finePerParent: number;
  parents: number;
  children: number;
  totalFine: number;
  grossSaving: number;
  netSaving: number;
}

// ── Section 3: All-in Family Cost Normalisation ────────────────────────────
export interface FareCostBreakdown {
  carrier: string;
  route: string;
  headlinePerPerson: number;
  baseFamilyTotal: number;
  holdLuggage: number;
  seatSelection: number;
  speedyBoarding: number;
  allInTotal: number;
  familySplitRisk: boolean; // airline uses algorithmic seating that splits families
  splitWarningCarriers: string[];
}

// ── Section 4: Party-Size-Aware Capacity Warning ───────────────────────────
export interface CapacityWarning {
  carrier: string;
  route: string;
  departureDate: string;
  fareClass: string;
  farePrice: number;
  seatsRemaining: number;
  partySize: number;
  nextFareClass: string;
  nextFarePrice: number;
  costImpact: number; // extra cost if fare-split happens
}

// ── Section 5: Multi-Airport London Search ─────────────────────────────────
export interface AirportFare {
  airport: 'LHR' | 'LGW' | 'STN' | 'LTN' | 'LCY';
  airportName: string;
  carrier: string;
  fareFamily: string;
  price: number; // per person
  familyTotal: number;
  transferMinutes: number;
  transferCost: number;
  transferMode: string;
  allInFromHome: number;
  departureTime: string;
  arrivalTime: string;
  recommended?: boolean;
}

// ── Section 6: Multi-City / Open-Jaw ──────────────────────────────────────
export interface OpenJawItinerary {
  id: string;
  label: string;
  outbound: { from: string; to: string; carrier: string; price: number; date: string; time: string };
  inbound:  { from: string; to: string; carrier: string; price: number; date: string; time: string };
  totalPrice: number;
  familyTotal: number;
  savingVsDirect: number;
  note: string;
  tags: string[];
}

// ── Section 7: Stopover Routing ────────────────────────────────────────────
export type KidAgeFriction = 'green' | 'amber' | 'red';
export interface StopoverRoute {
  id: string;
  via: string;
  viaCity: string;
  outboundCarrier: string;
  totalDuration: string; // e.g. "14h 30m"
  layoverDuration: string;
  layoverAirportLounge: boolean;
  totalPrice: number;
  familyTotal: number;
  directFamilyTotal: number;
  saving: number;
  kidAgeFriction: KidAgeFriction;
  frictionReason?: string;
  minRecommendedAge?: number;
  highlight?: string;
}

// ── Section 8: Nearby Destination Airports ─────────────────────────────────
export interface NearbyAirportOption {
  id: string;
  targetCity: string;
  cheaperAirport: string;
  cheaperAirportCode: string;
  mainAirport: string;
  mainAirportCode: string;
  flightPriceDiff: number; // cheaper is negative (saving)
  onwardTransport: string;
  onwardCost: number;
  onwardDuration: string;
  netSaving: number;
  tags: string[];
}

// ── Section 9: Multi-Modal Routing ────────────────────────────────────────
export interface MultiModalRoute {
  id: string;
  label: string;
  modes: string[];
  legs: {
    mode: 'eurostar' | 'train' | 'ferry' | 'flight' | 'bus';
    from: string;
    to: string;
    carrier: string;
    duration: string;
    cost: number;
    note?: string;
  }[];
  totalCost: number;
  familyTotal: number;
  directFlightFamilyTotal: number;
  saving: number;
  totalJourneyTime: string;
  experienceScore: number; // 1-5
  experienceNote: string;
  tags: string[];
}

// ── Section 10: Rail Children Travel Free ─────────────────────────────────
export interface RailChildPolicy {
  id: string;
  operator: string;
  countries: string[];
  policy: string;
  maxChildAge: number;
  maxChildrenPerAdult: number;
  requiresRegistration: boolean;
  route: string;
  adultFare: number;
  savingPerChild: number;
  totalFamilySaving: number;
  bookingNote: string;
  link?: string;
}

// ── Section 11: One-Way vs Return Analysis ────────────────────────────────
export type BookingConfig = 'single-return' | 'two-one-ways-same' | 'two-one-ways-split';
export interface FareConfig {
  id: BookingConfig;
  label: string;
  outboundCarrier: string;
  inboundCarrier: string;
  outboundPrice: number;
  inboundPrice: number;
  totalPerPerson: number;
  familyTotal: number;
  flexibility: 'low' | 'medium' | 'high';
  notes: string[];
  recommended: boolean;
  saving?: number; // vs most expensive option
  tags: string[];
}
