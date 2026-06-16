import type { ScoredCombination } from './buildCandidates';

// ── Tuning constants ──────────────────────────────────────────────────────
// NIGHT_VALUE: max flight premium we'll pay for one extra night (£)
// INSET_BONUS: value of inset day *beyond* any extra night it provides (£)
export const NIGHT_VALUE    = 80;
export const INSET_BONUS    = 30;

// ── Penalty tables (£) ───────────────────────────────────────────────────
export const ARRIVAL_PENALTY: Record<string, number> = {
  excellent:  0,
  good:       15,
  acceptable: 40,
  poor:       60,
};

export const OUT_DEP_PENALTY: Record<string, number> = {
  ideal:      0,
  good:       10,
  very_early: 35,
  poor:       50,
};

export const RET_DEP_PENALTY: Record<string, number> = {
  excellent:  0,
  good:       10,
  early:      25,
  very_early: 55,
};

// Destination transfer penalties (each direction, applied × 2 for both
// outbound arrival and return departure legs at the destination airport).
export const DEST_TRANSFER_PENALTY = (
  duration_mins: number | null,
): number => {
  if (duration_mins === null) return 15; // unknown — penalise, don't treat as free
  if (duration_mins < 30)  return 0;
  if (duration_mins < 60)  return 10;
  if (duration_mins < 90)  return 20;
  return 40; // REU/GRO level
};

// London transit penalties (each direction) — duration + extra-changes component.
export const LONDON_TRANSIT_PENALTY = (
  duration_mins: number,
  changes: number,
): number => {
  let p = 0;
  if (duration_mins > 105)     p += 35;
  else if (duration_mins > 75) p += 20;
  else if (duration_mins > 45) p += 10;
  p += Math.max(0, changes - 1) * 10;
  return p;
};

// ── Viability filter ─────────────────────────────────────────────────────
// Absence combinations are never recommended (shown in matrix only).
// Quality issues (poor arrival/departure) are handled as penalties in
// effectiveCost(), not hard exclusions — a poor outbound on an inset day
// is still a legitimate option the parent may have already chosen to take.
// Hard exclusions are reserved for genuinely unbookable/impossible cases.
export function viable(c: ScoredCombination): boolean {
  return (
    !c.requires_absence &&
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

  // London transit — outbound
  const outTransit = c.outbound_transit?.transit;
  if (outTransit && outTransit.confidence === 'ok') {
    cost += LONDON_TRANSIT_PENALTY(outTransit.duration_mins, outTransit.changes);
  }

  // London transit — return
  const retTransit = c.return_transit?.transit;
  if (retTransit && retTransit.confidence === 'ok') {
    cost += LONDON_TRANSIT_PENALTY(retTransit.duration_mins, retTransit.changes);
  }

  // Destination transfer — both directions (outbound arrival + return departure)
  cost += DEST_TRANSFER_PENALTY(c.destination_transit_duration_mins) * 2;

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
  console.log('[selectCombination] called, input count:', combinations.length,
    'viable:', combinations.filter(c => !c.requires_absence).length);

  const viable_combos = combinations.filter(viable);
  if (!viable_combos.length) return null;

  console.log('[selectCombination] entered, viable count:', viable_combos.length);

  const previouslyExcluded = viable_combos.filter(
    c => c.arrival_quality === 'poor' ||
         c.outbound_departure_quality === 'poor'
  );
  if (previouslyExcluded.length > 0) {
    console.log('[previously-excluded-now-included]',
      previouslyExcluded.map(c => ({
        out:      c.outbound_date,
        ret:      c.return_date,
        carrier:  c.outbound_carrier,
        out_dep_q: c.outbound_departure_quality,
        arr_q:    c.arrival_quality,
        eff:      effectiveCost(c),
      }))
    );
  }

  // Debug: top 3 candidates by effectiveCost, with full penalty breakdown —
  // computed and logged BEFORE the winner is picked, so Vercel logs show the
  // reasoning that determines the winner, not just the outcome.
  const top3 = [...viable_combos]
    .sort((a, b) => effectiveCost(a) - effectiveCost(b))
    .slice(0, 3)
    .map(c => {
      const outTransit = c.outbound_transit?.transit;
      const retTransit = c.return_transit?.transit;
      const outLondonPenalty =
        outTransit && outTransit.confidence === 'ok'
          ? LONDON_TRANSIT_PENALTY(outTransit.duration_mins, outTransit.changes)
          : 0;
      const retLondonPenalty =
        retTransit && retTransit.confidence === 'ok'
          ? LONDON_TRANSIT_PENALTY(retTransit.duration_mins, retTransit.changes)
          : 0;
      const destPenalty = DEST_TRANSFER_PENALTY(c.destination_transit_duration_mins);
      return {
        out: c.outbound_date, ret: c.return_date,
        carrier: c.outbound_carrier,
        nights: c.trip_nights, inset: c.is_inset_day,
        total: Math.round(c.total_cost_gbp),
        eff: Math.round(effectiveCost(c)),
        arr_q: c.arrival_quality,
        out_dep_q: c.outbound_departure_quality,
        ret_dep_q: c.return_departure_quality,
        eff_cost_breakdown: {
          total: Math.round(c.total_cost_gbp),
          night_credit: -(c.trip_nights * NIGHT_VALUE),
          inset_credit: c.is_inset_day ? -INSET_BONUS : 0,
          arrival_penalty: ARRIVAL_PENALTY[c.arrival_quality ?? ''] ?? 40,
          out_dep_penalty: OUT_DEP_PENALTY[c.outbound_departure_quality ?? ''] ?? 35,
          ret_dep_penalty: RET_DEP_PENALTY[c.return_departure_quality ?? ''] ?? 35,
          out_london_penalty: outLondonPenalty,
          ret_london_penalty: retLondonPenalty,
          dest_transfer_penalty_x2: destPenalty * 2,
          final_eff_cost: Math.round(effectiveCost(c)),
        },
      };
    });
  console.log('[selectCombination] top3 by effCost:', JSON.stringify(top3, null, 2));

  // ── Pick winner: minimum effective cost ──────────────────────────────
  const winner = viable_combos.reduce((best, c) =>
    effectiveCost(c) < effectiveCost(best) ? c : best
  );
  const winnerEffCost = effectiveCost(winner);

  console.log('[selectCombination] winner:', winner.outbound_date, '→', winner.return_date,
    'eff:', Math.round(winnerEffCost));

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

  console.log('[selectCombination-winner]', {
    out:     winner.outbound_date,
    ret:     winner.return_date,
    carrier: winner.outbound_carrier + '+' +
             winner.return_carrier,
    nights:  winner.trip_nights,
    total:   winner.total_cost_gbp,
    eff:     effectiveCost(winner),
    breakdown: {
      night_credit: -(NIGHT_VALUE * winner.trip_nights),
      inset_bonus:  winner.is_inset_day
                    ? -INSET_BONUS : 0,
      arrival_pen:  ARRIVAL_PENALTY[
                    winner.arrival_quality ?? ''] ?? 40,
      out_dep_pen:  OUT_DEP_PENALTY[
                    winner.outbound_departure_quality
                    ?? ''] ?? 35,
      ret_dep_pen:  RET_DEP_PENALTY[
                    winner.return_departure_quality
                    ?? ''] ?? 35,
      out_london_pen: (() => {
        const t = winner.outbound_transit?.transit;
        return t && t.confidence === 'ok'
          ? LONDON_TRANSIT_PENALTY(
              t.duration_mins, t.changes)
          : 0;
      })(),
      ret_london_pen: (() => {
        const t = winner.return_transit?.transit;
        return t && t.confidence === 'ok'
          ? LONDON_TRANSIT_PENALTY(
              t.duration_mins, t.changes)
          : 0;
      })(),
      dest_pen_x2: DEST_TRANSFER_PENALTY(
        winner.destination_transit_duration_mins
      ) * 2,
    }
  });

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
