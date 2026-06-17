import { AssembledCombination } from './assembleRecommendation';
import { effectiveCost } from './selectCombination';

// ── Quality field computation ─────────────────────────────────────────────────
// These are pre-computed labels the AI uses for reasoning.
// Applied to every combination before shortlist selection.

export interface QualityFields {
  arrival_quality: 'excellent' | 'good' | 'acceptable' | 'poor' | null;
  outbound_departure_quality: 'ideal' | 'good' | 'very_early' | 'poor' | null;
  return_departure_quality: 'excellent' | 'good' | 'early' | 'very_early' | null;
  total_outbound_travel_mins: number | null;
  trip_nights: number;
}

export function computeQualityFields(c: AssembledCombination): QualityFields {
  // Arrival quality at destination
  const arrival_quality = (() => {
    if (!c.outbound_arrival_time) return null;
    const [h, m] = c.outbound_arrival_time.split(':').map(Number);
    const t = h + m / 60;
    if (t < 14) return 'excellent'; // before 14:00 — full afternoon
    if (t < 18) return 'good';      // 14:00–18:00 — still useful
    if (t < 21) return 'acceptable'; // 18:00–21:00 — evening only
    return 'poor';                   // after 21:00 — night arrival
  })() as QualityFields['arrival_quality'];

  // Outbound departure quality — leaving home for the airport
  const outbound_departure_quality = (() => {
    if (!c.outbound_departure_time) return null;
    const [h, m] = c.outbound_departure_time.split(':').map(Number);
    const t = h + m / 60;
    if (t < 9)  return 'very_early'; // before 09:00 — 4/5am wake-up
    if (t < 13) return 'ideal';      // 09:00–13:00 — sweet spot
    if (t < 17) return 'good';       // 13:00–17:00 — relaxed but late arrival
    return 'poor';                   // after 17:00 — arrives at night
  })() as QualityFields['outbound_departure_quality'];

  // Return departure quality — leaving destination to come home
  const return_departure_quality = (() => {
    if (!c.return_departure_time) return null;
    const [h, m] = c.return_departure_time.split(':').map(Number);
    const t = h + m / 60;
    if (t < 9)  return 'very_early'; // before 09:00 — last day gone entirely
    if (t < 13) return 'early';      // 09:00–13:00 — morning checkout only
    if (t < 17) return 'good';       // 13:00–17:00 — most of last day usable
    return 'excellent';              // after 17:00 — full last day
  })() as QualityFields['return_departure_quality'];

  // Total outbound travel time door-to-door
  const total_outbound_travel_mins = (
    (c.outbound_transit?.transit?.duration_mins ??
     c.outbound_transit?.uber?.duration_mins ?? 0) +
    (c.outbound_duration_mins ?? 0)
  ) || null;

  // Trip duration in nights
  const trip_nights = Math.round(
    (new Date(c.return_date + 'T00:00:00').getTime() -
     new Date(c.outbound_date + 'T00:00:00').getTime()) /
    (1000 * 60 * 60 * 24)
  );

  return {
    arrival_quality,
    outbound_departure_quality,
    return_departure_quality,
    total_outbound_travel_mins,
    trip_nights,
  };
}

// ── Pre-score ─────────────────────────────────────────────────────────────────
// TypeScript scoring for shortlist selection.
// This is NOT the AI's scoring — it's a pre-filter to select diverse candidates.
// Higher score = better candidate for the shortlist.

export function preScore(
  c: AssembledCombination,
  quality: QualityFields,
  cheapestCost: number,
): number {
  // Cost score (35 points)
  const costScore = Math.max(15, 35 - (c.total_inc_fine - cheapestCost) / 25);

  // Inset day bonus (10 points) — only if arrival is good enough to use the day
  const insetBonus =
    c.is_inset_day &&
    (quality.arrival_quality === 'excellent' || quality.arrival_quality === 'good')
      ? 10
      : c.is_inset_day
      ? 3  // inset day but poor/acceptable arrival — minor bonus for no absence
      : 0;

  // Arrival quality (20 points)
  const arrivalScore = {
    excellent: 20,
    good: 15,
    acceptable: 6,
    poor: 0,
  }[quality.arrival_quality ?? 'poor'] ?? 0;

  // Outbound departure quality (15 points)
  const outboundDepartureScore = {
    ideal: 15,
    good: 10,
    very_early: 6,
    poor: 2,
  }[quality.outbound_departure_quality ?? 'poor'] ?? 0;

  // Return departure quality (15 points)
  const returnDepartureScore = {
    excellent: 15,
    good: 12,
    early: 5,
    very_early: 2,
  }[quality.return_departure_quality ?? 'very_early'] ?? 0;

  // Journey ease (5 points)
  const changes = c.outbound_transit?.transit?.changes ?? 1;
  const mins = quality.total_outbound_travel_mins ?? 120;
  const journeyScore =
    changes === 0 && mins < 90 ? 5 :
    changes === 0 ? 4 :
    changes === 1 ? 3 : 1;

  // Nights efficiency (4 points per night)
  const nightsScore = quality.trip_nights * 4;

  return costScore + insetBonus + arrivalScore +
         outboundDepartureScore + returnDepartureScore + journeyScore + nightsScore;
}

// ── Scored combination type ───────────────────────────────────────────────────

export interface ScoredCombination extends AssembledCombination, QualityFields {
  pre_score: number;
}

// ── Combination identity ──────────────────────────────────────────────────────
// Two combinations are the same trip if they share outbound date, return date,
// origin airport, destination airport, and both carriers. Different baggage/
// seat assumptions on the same flight pair do not make it a distinct trip.

export function combinationKey(
  c: Pick<AssembledCombination, 'outbound_date' | 'return_date' | 'origin_iata' | 'out_dest_iata' | 'outbound_carrier' | 'return_carrier'>,
): string {
  return `${c.outbound_date}_${c.return_date}_${c.origin_iata}_${c.out_dest_iata}_${c.outbound_carrier}_${c.return_carrier}`;
}

// ── Score and dedupe the full pool ────────────────────────────────────────────
// Canonical entry point for turning raw SQL combinations into the scored set
// that effectiveCost()/selectCombination() and the shortlist both draw from.
// Dedup keeps the cheapest (by total_inc_fine) representative per trip — same
// flight pair under different baggage/seat assumptions collapses to one entry.

export function scoreAndDedupeCombinations(
  combinations: AssembledCombination[],
): ScoredCombination[] {
  if (!combinations.length) return [];

  const cheapestPerKey = new Map<string, AssembledCombination>();
  for (const c of combinations) {
    const key = combinationKey(c);
    const existing = cheapestPerKey.get(key);
    if (!existing || c.total_inc_fine < existing.total_inc_fine) {
      cheapestPerKey.set(key, c);
    }
  }
  const deduped = Array.from(cheapestPerKey.values());

  const cheapestCost = Math.min(...deduped.map(c => c.total_inc_fine));

  return deduped.map(c => {
    const quality = computeQualityFields(c);
    return {
      ...c,
      ...quality,
      pre_score: preScore(c, quality, cheapestCost),
    };
  });
}

// ── Build candidate shortlist ─────────────────────────────────────────────────
// Selects 2–5 role-based combinations for the AI to reason across.
// Winner is injected by withWinnerIncluded after this returns.

export function buildCandidateShortlist(
  scored: ScoredCombination[],
): ScoredCombination[] {
  if (!scored.length) return [];

  const nonBaseline = scored.filter(c => !(c as any).is_baseline);
  if (!nonBaseline.length) return [];

  const selected = new Map<string, ScoredCombination>();
  const byEff = [...nonBaseline].sort((a, b) => effectiveCost(a) - effectiveCost(b));
  const winnerKey = combinationKey(byEff[0]);

  function add(c: ScoredCombination | undefined, _label: string) {
    if (!c) return;
    const key = combinationKey(c);
    if (key === winnerKey) return;
    if (!selected.has(key)) selected.set(key, c);
  }

  // Slot 2 — best_inset: lowest eff_cost where is_inset_day = true
  add(byEff.find(c => c.is_inset_day), 'best_inset');

  // Slot 3 — cheapest_raw: lowest total_cost_gbp
  const cheapest = [...nonBaseline].sort((a, b) => a.total_cost_gbp - b.total_cost_gbp)[0];
  add(cheapest, 'cheapest_raw');

  // Slot 4 — best_quality: lowest eff_cost with good outbound departure AND
  // excellent/good/early return departure
  const goodOutDep = new Set<string>(['ideal', 'good']);
  const goodRetDep = new Set<string>(['excellent', 'good', 'early']);
  add(
    byEff.find(c =>
      goodOutDep.has(c.outbound_departure_quality ?? '') &&
      goodRetDep.has(c.return_departure_quality ?? ''),
    ),
    'best_quality',
  );

  // Slot 5 — best_alt_airport: lowest eff_cost from a different origin,
  // only if within £150 eff_cost of the winner
  const winnerEff = effectiveCost(byEff[0]);
  const altAirport = byEff.find(c =>
    c.origin_iata !== byEff[0].origin_iata &&
    effectiveCost(c) - winnerEff <= 150,
  );
  add(altAirport, 'best_alt_airport');

  return Array.from(selected.values())
    .sort((a, b) => effectiveCost(a) - effectiveCost(b));
}

// ── Guarantee winner membership ───────────────────────────────────────────────
// The winner is chosen by minimum effectiveCost() over the full scored pool and
// may not land in any of the 11 diversity categories above. Anything sent
// downstream that does a shortlist.find(winner) (AI prompt assembly, recEffCost
// lookups) needs the winner present or it silently falls back to shortlist[0].
export function withWinnerIncluded(
  shortlist: ScoredCombination[],
  winner: ScoredCombination,
): ScoredCombination[] {
  const winnerKey = combinationKey(winner);
  if (shortlist.some(c => combinationKey(c) === winnerKey)) return shortlist;
  return [winner, ...shortlist];
}

// ── Benchmark cost computation ────────────────────────────────────────────────
// Computes the "typical Saturday booking" benchmark cost.
// Definition: cheapest no-absence, same-carrier, Saturday departure,
// from nearest London airport, to primary destination airport,
// returning Tuesday (3-night) or Wednesday (4-night).

export function computeBenchmark(
  combinations: ScoredCombination[],
  windowStart: string,
  nearestAirport: string,
  primaryDestAirport: string,
  recommendedTripNights: number,
): number | null {
  // Find first Saturday on or after window start
  function getFirstSaturday(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }

  function addDays(dateStr: string, days: number): string {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  }

  const firstSaturday = getFirstSaturday(windowStart);
  const returnDate = addDays(firstSaturday, recommendedTripNights);

  // Filter to benchmark definition
  const matches = combinations.filter(c =>
    c.outbound_date === firstSaturday &&
    c.return_date === returnDate &&
    c.origin_iata === nearestAirport &&
    c.out_dest_iata === primaryDestAirport &&
    c.ret_dest_iata === nearestAirport &&
    !c.requires_absence &&
    !c.split_carrier // same carrier both ways
  );

  if (!matches.length) {
    // Fallback 1: allow any carrier (including split)
    const fallback1 = combinations.filter(c =>
      c.outbound_date === firstSaturday &&
      c.return_date === returnDate &&
      c.origin_iata === nearestAirport &&
      c.out_dest_iata === primaryDestAirport &&
      !c.requires_absence
    );
    if (fallback1.length) {
      return Math.min(...fallback1.map(c => c.total_inc_fine));
    }

    // Fallback 2: any Saturday departure, same trip duration
    const fallback2 = combinations.filter(c => {
      const day = new Date(c.outbound_date + 'T00:00:00').getDay();
      return day === 6 &&
             c.trip_nights === recommendedTripNights &&
             !c.requires_absence;
    });
    if (fallback2.length) {
      const sorted = [...fallback2].sort((a, b) => a.total_inc_fine - b.total_inc_fine);
      const mid = Math.floor(sorted.length / 2);
      return sorted[mid].total_inc_fine; // median
    }

    return null; // no benchmark available
  }

  // Cheapest matching combination
  return Math.min(...matches.map(c => c.total_inc_fine));
}

// ── Cost range computation ────────────────────────────────────────────────────
// Computes the low/high cost range for a combination.
// Uses min/max bag fees for FR/W6, Uber range for transport.

export interface CostRange {
  low: number;
  high: number;
  midpoint: number;
  has_range: boolean; // false if low === high (all costs are exact)
  bag_is_estimated: boolean;
  transit_is_ranged: boolean;
}

export function computeCostRange(
  c: AssembledCombination,
  transitPreference: 'auto' | 'uber' | 'transit',
): CostRange {
  const baseFare = c.outbound_fare_gbp + c.return_fare_gbp;
  const seatCost = c.seat_cost_gbp;
  const transfer = c.destination_transfer_cost_gbp;

  // Bag cost range
  // cabin_bag_cost_min_gbp / cabin_bag_cost_max_gbp are new fields
  // added in the SQL extension (Prompt 2). Fall back to single value if absent.
  const bagLow = (c as any).cabin_bag_cost_min_gbp ?? c.cabin_bag_cost_gbp;
  const bagHigh = (c as any).cabin_bag_cost_max_gbp ?? c.cabin_bag_cost_gbp;
  const checkedLow = (c as any).checked_bag_cost_min_gbp ?? c.checked_bag_cost_gbp;
  const checkedHigh = (c as any).checked_bag_cost_max_gbp ?? c.checked_bag_cost_gbp;

  // Transit cost range
  const outUberLow = c.outbound_transit?.uber?.low_pence != null
    ? c.outbound_transit.uber.low_pence / 100 : null;
  const outUberHigh = c.outbound_transit?.uber?.high_pence != null
    ? c.outbound_transit.uber.high_pence / 100 : null;
  const retUberLow = c.return_transit?.uber?.low_pence != null
    ? c.return_transit.uber.low_pence / 100 : null;
  const retUberHigh = c.return_transit?.uber?.high_pence != null
    ? c.return_transit.uber.high_pence / 100 : null;

  const transitExact = c.transit_cost_gbp;

  let transitLow: number;
  let transitHigh: number;

  if (transitPreference === 'uber') {
    transitLow = (outUberLow ?? 0) + (retUberLow ?? 0);
    transitHigh = (outUberHigh ?? 0) + (retUberHigh ?? 0);
  } else {
    // Auto: use transit as base, Uber high as ceiling
    transitLow = transitExact;
    transitHigh = transitExact; // transit fare is fixed
  }

  const low = baseFare + bagLow + checkedLow + seatCost + transitLow + transfer;
  const high = baseFare + bagHigh + checkedHigh + seatCost + transitHigh + transfer;

  return {
    low: Math.round(low * 100) / 100,
    high: Math.round(high * 100) / 100,
    midpoint: c.total_cost_gbp,
    has_range: Math.abs(high - low) > 5, // only show range if spread > £5
    bag_is_estimated: c.baggage_is_estimate,
    transit_is_ranged: transitPreference === 'uber' &&
      (outUberLow !== outUberHigh || retUberLow !== retUberHigh),
  };
}
