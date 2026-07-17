'use client';

import type { AssembledCombination, AssembledBaseline, BaselineAsItinerary } from '@/lib/flights/assembleRecommendation';

// ── Interfaces ─────────────────────────────────────────────────────────────────

interface Lever {
  label: string;
  winner: string;
  saving: number;
  above_threshold: boolean;
  is_borough_specific: boolean;
}

export interface SavingsData {
  baseline_price: number;
  smart_price: number;
  total_yield: number;
  net_yield: number;
  fine_gbp: number;
  fine_is_estimate: boolean;
  requires_absence: boolean;
  best_outbound_date: string;
  best_return_date: string;
  departure_absence_days: number;
  return_absence_days: number;
  levers: Lever[];
}

interface Props {
  data: SavingsData;        // kept for interface stability; no longer rendered
  adults: number;
  children: number;
  windowStart: string;
  destinationSlug: string;
  boroughName: string | null;
  recommendation: AssembledCombination | null;
  baseline: AssembledBaseline | null;
  outbound_transit: AssembledCombination['outbound_transit'] | null;
  return_transit: AssembledCombination['return_transit'] | null;
  postcodeDistrict: string | null;
  cabinBags: number;
  checkedBags: number;
  seatsTogether: boolean;
  party_size: number;
  combinations?: AssembledCombination[];
  savingCategory: 'significant' | 'found_saving' | 'baseline_cheapest';
  schoolName: string | null;
  baselineIsRecommended?: boolean;
  baselineAsItinerary?: BaselineAsItinerary;
}

// ── Component ─────────────────────────────────────────────────────────────────
// The "How we calculated your saving" expandable cost breakdown has been
// removed — the comparison table carries this information now. Props kept
// for interface stability with app/results/flight-insights/page.tsx.

export function SavingsBreakdown(_props: Props) {
  return null;
}
