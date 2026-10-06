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
