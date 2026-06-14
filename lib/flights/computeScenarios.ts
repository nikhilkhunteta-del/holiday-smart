import type { AssembledCombination } from './assembleRecommendation';
import { NIGHT_VALUE } from './selectCombination';
export type { ScenarioResult } from './buildScenarioResults';
import type { ScenarioResult } from './buildScenarioResults';

const round  = (n: number) => Math.round(n);
const round5 = (n: number) => Math.round(n / 5) * 5;

const CARRIER_NAMES: Record<string, string> = {
  BA: 'British Airways', U2: 'easyJet', FR: 'Ryanair',
  W6: 'Wizz Air', VY: 'Vueling', TP: 'TAP Air Portugal',
};
const cn = (iata: string) => CARRIER_NAMES[iata] ?? iata;

function tripNightsFromDates(outbound_date: string, return_date: string): number {
  return Math.round(
    (new Date(return_date + 'T00:00:00').getTime() -
     new Date(outbound_date + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24),
  );
}

// ── Adjust combination costs for a scenario ─────────────────────────────────
// Returns new total_cost_gbp without mutating original.
function adjustedTotal(
  c: AssembledCombination,
  opts: {
    zeroBags?:    boolean;  // cabin + checked bags = 0
    zeroSeats?:   boolean;  // seat_cost_gbp = 0
    useUber?:     boolean;  // swap transit for Uber mean
    useTransit?:  boolean;  // swap Uber for transit
  },
): number {
  let total = c.total_cost_gbp;

  if (opts.zeroBags) {
    total -= c.cabin_bag_cost_gbp;
    total -= c.checked_bag_cost_gbp;
  }

  if (opts.zeroSeats) {
    total -= c.seat_cost_gbp;
  }

  if (opts.useUber) {
    const outUberMean = c.outbound_transit?.uber?.mean_pence
      ? c.outbound_transit.uber.mean_pence / 100 : null;
    const retUberMean = c.return_transit?.uber?.mean_pence
      ? c.return_transit.uber.mean_pence / 100 : null;
    if (outUberMean != null) {
      total = total - c.outbound_transit_cost_gbp + outUberMean;
    }
    if (retUberMean != null) {
      total = total - c.return_transit_cost_gbp + retUberMean;
    }
  }

  if (opts.useTransit) {
    const outTransitFare = c.outbound_transit?.transit?.total_family_pence != null
      ? c.outbound_transit.transit.total_family_pence / 100 : null;
    const retTransitFare = c.return_transit?.transit?.total_family_pence != null
      ? c.return_transit.transit.total_family_pence / 100 : null;
    if (outTransitFare != null) {
      total = total - c.outbound_transit_cost_gbp + outTransitFare;
    }
    if (retTransitFare != null) {
      total = total - c.return_transit_cost_gbp + retTransitFare;
    }
  }

  return total;
}

// ── Run selection on adjusted costs ─────────────────────────────────────────
function selectWithAdjustedCosts(
  combinations: AssembledCombination[],
  opts: Parameters<typeof adjustedTotal>[1],
): AssembledCombination | null {
  const viableCombos = combinations.filter(c => !c.requires_absence);
  if (!viableCombos.length) return null;

  return viableCombos.reduce((best, c) => {
    const nights    = tripNightsFromDates(c.outbound_date, c.return_date);
    const bestNights = tripNightsFromDates(best.outbound_date, best.return_date);
    const adjC    = adjustedTotal(c, opts);
    const adjBest = adjustedTotal(best, opts);
    const effC    = adjC    - NIGHT_VALUE * nights     - (c.is_inset_day    ? 30 : 0);
    const effBest = adjBest - NIGHT_VALUE * bestNights - (best.is_inset_day ? 30 : 0);
    return effC < effBest ? c : best;
  }, viableCombos[0]);
}

// ── Build scenario result ────────────────────────────────────────────────────
function buildScenario(
  lever: string,
  headline: string,
  currentWinner: AssembledCombination,
  scenarioWinner: AssembledCombination | null,
  currentTotal: number,
  scenarioAdjustedTotal: number,
  facts: Record<string, string | number | boolean | null>,
  urlParams: Record<string, string>,
): ScenarioResult {
  const flightChanges = scenarioWinner != null && (
    scenarioWinner.outbound_date    !== currentWinner.outbound_date    ||
    scenarioWinner.return_date      !== currentWinner.return_date      ||
    scenarioWinner.origin_iata      !== currentWinner.origin_iata      ||
    scenarioWinner.outbound_carrier !== currentWinner.outbound_carrier
  );

  return {
    lever,
    locked_headline: headline,
    current_total:   round(currentTotal),
    scenario_total:  round(scenarioAdjustedTotal),
    saving:          round(currentTotal - scenarioAdjustedTotal),
    flight_changes:  flightChanges,
    scenario_winner: scenarioWinner ? {
      outbound_date:    scenarioWinner.outbound_date,
      return_date:      scenarioWinner.return_date,
      outbound_carrier: scenarioWinner.outbound_carrier,
      return_carrier:   scenarioWinner.return_carrier,
      origin_iata:      scenarioWinner.origin_iata,
      out_dest_iata:    scenarioWinner.out_dest_iata,
      trip_nights:      tripNightsFromDates(
        scenarioWinner.outbound_date, scenarioWinner.return_date
      ),
    } : null,
    facts,
    url_params: urlParams,
  };
}

// ── Main export ──────────────────────────────────────────────────────────────
export function computeScenarios(
  combinations: AssembledCombination[],
  currentWinner: AssembledCombination,
  currentTransitPreference: 'auto' | 'uber',
  adults: number,
  children: number,
  currentCabinBags: number,
  currentCheckedBags: number,
  currentSeatsTogether: boolean,
): ScenarioResult[] {
  const results: ScenarioResult[] = [];
  const currentTotal = currentWinner.total_cost_gbp;

  // ── SCENARIO 1 — Travel light ──────────────────────────────────────────────
  const currentBagCost = currentWinner.cabin_bag_cost_gbp + currentWinner.checked_bag_cost_gbp;

  if (currentBagCost > 0 && currentCabinBags > 0) {
    const opts = { zeroBags: true };
    const scenarioWinner = selectWithAdjustedCosts(combinations, opts);
    const scenarioTotal  = scenarioWinner
      ? adjustedTotal(scenarioWinner, opts)
      : currentTotal - currentBagCost;

    const saving = round(currentTotal - scenarioTotal);

    if (saving > 0) {
      results.push(buildScenario(
        'travel_light',
        'Travel light — skip cabin bags',
        currentWinner,
        scenarioWinner,
        currentTotal,
        scenarioTotal,
        {
          bag_saving:       saving,
          current_bags:     currentCabinBags,
          current_total:    round(currentTotal),
          scenario_total:   round(scenarioTotal),
          flight_changes:   scenarioWinner?.outbound_date !== currentWinner.outbound_date,
          scenario_carrier: scenarioWinner ? cn(scenarioWinner.outbound_carrier) : null,
          scenario_dates:   scenarioWinner
            ? `${scenarioWinner.outbound_date} – ${scenarioWinner.return_date}`
            : null,
        },
        { cabin_bags: '0', checked_bags: '0' },
      ));
    }
  }

  // ── SCENARIO 2 — Skip seat selection ──────────────────────────────────────
  const currentSeatCost = currentWinner.seat_cost_gbp;

  if (currentSeatsTogether && currentSeatCost > 0) {
    const opts = { zeroSeats: true };
    const scenarioWinner = selectWithAdjustedCosts(combinations, opts);
    const scenarioTotal  = scenarioWinner
      ? adjustedTotal(scenarioWinner, opts)
      : currentTotal - currentSeatCost;

    const saving = round(currentTotal - scenarioTotal);

    if (saving > 0) {
      results.push(buildScenario(
        'skip_seats',
        'Skip seat selection — save the fee',
        currentWinner,
        scenarioWinner,
        currentTotal,
        scenarioTotal,
        {
          seat_saving:   saving,
          current_total: round(currentTotal),
          scenario_total: round(scenarioTotal),
          caveat: 'You may not sit together — airlines try to seat families but cannot guarantee it.',
          flight_changes: scenarioWinner?.outbound_date !== currentWinner.outbound_date,
        },
        { seats: 'false' },
      ));
    }
  }

  // ── SCENARIO 3 — Transport flip ───────────────────────────────────────────
  if (currentTransitPreference !== 'uber') {
    const outUberLow  = currentWinner.outbound_transit?.uber?.low_pence
      ? round5(currentWinner.outbound_transit.uber.low_pence / 100)  : null;
    const outUberHigh = currentWinner.outbound_transit?.uber?.high_pence
      ? round5(currentWinner.outbound_transit.uber.high_pence / 100) : null;
    const retUberLow  = currentWinner.return_transit?.uber?.low_pence
      ? round5(currentWinner.return_transit.uber.low_pence / 100)    : null;
    const retUberHigh = currentWinner.return_transit?.uber?.high_pence
      ? round5(currentWinner.return_transit.uber.high_pence / 100)   : null;

    if (outUberLow != null) {
      const uberOpts      = { useUber: true };
      const scenarioWinner = selectWithAdjustedCosts(combinations, uberOpts);
      const scenarioTotal  = scenarioWinner
        ? adjustedTotal(scenarioWinner, uberOpts)
        : currentTotal;

      const costDiff = round(scenarioTotal - currentTotal);

      results.push(buildScenario(
        'transport_flip',
        costDiff > 0
          ? `Door-to-door Uber — £${costDiff} more`
          : `Uber saves £${Math.abs(costDiff)}`,
        currentWinner,
        scenarioWinner,
        currentTotal,
        scenarioTotal,
        {
          out_uber_low:    outUberLow,
          out_uber_high:   outUberHigh,
          ret_uber_low:    retUberLow,
          ret_uber_high:   retUberHigh,
          cost_diff:       costDiff,
          costs_more:      costDiff > 0,
          current_transit_route:
            currentWinner.outbound_transit?.transit?.route_summary ?? null,
          current_transit_cost:
            round(currentWinner.outbound_transit_cost_gbp + currentWinner.return_transit_cost_gbp),
          flight_changes: scenarioWinner?.outbound_date !== currentWinner.outbound_date,
        },
        { transit: 'uber' },
      ));
    }
  } else {
    const transitOpts    = { useTransit: true };
    const scenarioWinner = selectWithAdjustedCosts(combinations, transitOpts);
    const scenarioTotal  = scenarioWinner
      ? adjustedTotal(scenarioWinner, transitOpts)
      : currentTotal;

    const saving = round(currentTotal - scenarioTotal);

    if (saving > 0) {
      results.push(buildScenario(
        'transport_flip',
        `Public transport saves £${saving}`,
        currentWinner,
        scenarioWinner,
        currentTotal,
        scenarioTotal,
        {
          transit_saving:  saving,
          current_total:   round(currentTotal),
          scenario_total:  round(scenarioTotal),
          transit_route:
            scenarioWinner?.outbound_transit?.transit?.route_summary ?? null,
          flight_changes: scenarioWinner?.outbound_date !== currentWinner.outbound_date,
        },
        { transit: 'auto' },
      ));
    }
  }

  return results;
}
