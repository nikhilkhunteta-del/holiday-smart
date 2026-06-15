import type { ScoredCombination } from './buildCandidates';

// ── Tuning constants ──────────────────────────────────────────────────────
// NIGHT_VALUE: max flight premium we'll pay for one extra night (£)
// INSET_BONUS: value of inset day *beyond* any extra night it provides (£)
// CHANGE_PENALTY: per transit change beyond the first (£)
export const NIGHT_VALUE    = 80;
export const INSET_BONUS    = 30;
export const CHANGE_PENALTY = 10;

// ── Penalty tables (£) ───────────────────────────────────────────────────
const ARRIVAL_PENALTY: Record<string, number> = {
  excellent:  0,
  good:       15,
  acceptable: 40,
  // 'poor' → excluded via viable()
};

const OUT_DEP_PENALTY: Record<string, number> = {
  ideal:      0,
  good:       10,
  very_early: 35,
  // 'poor' → excluded via viable()
};

const RET_DEP_PENALTY: Record<string, number> = {
  excellent:  0,
  good:       10,
  early:      25,
  very_early: 55,
};

// ── Viability filter ─────────────────────────────────────────────────────
// Absence combinations are never recommended (shown in matrix only).
// Poor arrival/departure quality means first or last day is wasted.
export function viable(c: ScoredCombination): boolean {
  return (
    !c.requires_absence &&
    c.arrival_quality !== 'poor' &&
    c.outbound_departure_quality !== 'poor' &&
    c.trip_nights >= 1
  );
}

// ── Effective cost ────────────────────────────────────────────────────────
// Lower is better. Converts all factors to £ so weights are self-documenting.
export function effectiveCost(c: ScoredCombination): number {
  let cost = c.total_cost_gbp;

  // Credits (reduce effective cost)
  cost -= NIGHT_VALUE * c.trip_nights;
  if (c.is_inset_day) cost -= INSET_BONUS;

  // Penalties (increase effective cost)
  cost += ARRIVAL_PENALTY[c.arrival_quality ?? '']              ?? 40;
  cost += OUT_DEP_PENALTY[c.outbound_departure_quality ?? '']   ?? 35;
  cost += RET_DEP_PENALTY[c.return_departure_quality ?? '']     ?? 35;
  cost += CHANGE_PENALTY * Math.max(0, (c.outbound_transit?.transit?.changes ?? 0) - 1);

  return cost;
}

// ── Context set for copy generation ──────────────────────────────────────
export interface SelectionContext {
  winner:          ScoredCombination;
  winnerEffCost:   number;
  cheapestOverall: ScoredCombination;       // lowest total_cost_gbp (viable)
  cheapestInset:   ScoredCombination | null; // lowest total_cost_gbp with is_inset_day
  mostNights:      ScoredCombination;       // most trip_nights (viable)
  // Pre-computed deltas for copy — model verbalises, never subtracts
  vsChepeast: {
    cost_diff_gbp:   number;  // winner.total_cost_gbp - cheapestOverall.total_cost_gbp
    nights_diff:     number;  // winner.trip_nights - cheapestOverall.trip_nights
    winner_is_cheapest: boolean;
  };
  vsInset: {
    cost_diff_gbp:   number;  // winner.total_cost_gbp - cheapestInset.total_cost_gbp
    nights_diff:     number;
    winner_is_inset: boolean;
  } | null;
}

export function selectCombination(
  combinations: ScoredCombination[],
): SelectionContext | null {
  const viable_combos = combinations.filter(viable);
  if (!viable_combos.length) return null;

  // ── Pick winner: minimum effective cost ──────────────────────────────
  const winner = viable_combos.reduce((best, c) =>
    effectiveCost(c) < effectiveCost(best) ? c : best
  );
  const winnerEffCost = effectiveCost(winner);

  // ── Context set ───────────────────────────────────────────────────────
  const cheapestOverall = viable_combos.reduce((best, c) =>
    c.total_cost_gbp < best.total_cost_gbp ? c : best
  );

  const insetCombos = viable_combos.filter(c => c.is_inset_day);
  const cheapestInset = insetCombos.length
    ? insetCombos.reduce((best, c) =>
        c.total_cost_gbp < best.total_cost_gbp ? c : best
      )
    : null;

  const mostNights = viable_combos.reduce((best, c) =>
    c.trip_nights > best.trip_nights ? c : best
  );

  // ── Pre-computed deltas ───────────────────────────────────────────────
  const vsChepeast = {
    cost_diff_gbp:      Math.round(winner.total_cost_gbp - cheapestOverall.total_cost_gbp),
    nights_diff:        winner.trip_nights - cheapestOverall.trip_nights,
    winner_is_cheapest: winner.outbound_date === cheapestOverall.outbound_date &&
                        winner.return_date   === cheapestOverall.return_date,
  };

  const vsInset = cheapestInset ? {
    cost_diff_gbp:   Math.round(winner.total_cost_gbp - cheapestInset.total_cost_gbp),
    nights_diff:     winner.trip_nights - cheapestInset.trip_nights,
    winner_is_inset: winner.is_inset_day,
  } : null;

  return {
    winner,
    winnerEffCost,
    cheapestOverall,
    cheapestInset,
    mostNights,
    vsChepeast,
    vsInset,
  };
}
