import type {
  AssembledCombination,
  CombinationsOnlyResult,
} from './assembleRecommendation';

const round = (n: number) => Math.round(n);
const round5 = (n: number) => Math.round(n / 5) * 5;

const CARRIER_NAMES: Record<string, string> = {
  BA: 'British Airways', U2: 'easyJet', FR: 'Ryanair',
  W6: 'Wizz Air', VY: 'Vueling', TP: 'TAP Air Portugal',
};
const cn = (iata: string) => CARRIER_NAMES[iata] ?? iata;

const AIRPORT_NAMES: Record<string, string> = {
  LHR: 'Heathrow', LGW: 'Gatwick', STN: 'Stansted',
  LTN: 'Luton', LCY: 'City', SEN: 'Southend',
};
const an = (iata: string) => AIRPORT_NAMES[iata] ?? iata;

export interface ScenarioResult {
  lever:           string;
  locked_headline: string;
  current_total:   number;
  scenario_total:  number;
  saving:          number;
  flight_changes:  boolean;
  facts:           Record<string, string | number | boolean | null>;
  url_params:      Record<string, string>;
}

function flightChanged(
  current: AssembledCombination,
  scenario: AssembledCombination,
): boolean {
  return (
    current.outbound_date    !== scenario.outbound_date ||
    current.return_date      !== scenario.return_date   ||
    current.origin_iata      !== scenario.origin_iata   ||
    current.outbound_carrier !== scenario.outbound_carrier ||
    current.return_carrier   !== scenario.return_carrier
  );
}

export function buildScenarioResults(
  currentWinner: AssembledCombination | null,
  currentAssembled: CombinationsOnlyResult | null,
  scenarioResults: {
    light?:   CombinationsOnlyResult | null;
    checked?: CombinationsOnlyResult | null;
    uber?:    CombinationsOnlyResult | null;
    seats?:   CombinationsOnlyResult | null;
    transit?: CombinationsOnlyResult | null;
  },
  params: {
    cabinBags:         number;
    checkedBags:       number;
    seatsTogether:     boolean;
    transitPreference: 'auto' | 'uber' | 'transit';
    adults:            number;
    destinationName?:  string;
    firstCheckedBagGbp?: number;
  },
): ScenarioResult[] {
  if (!currentWinner || !currentAssembled) return [];

  const results: ScenarioResult[] = [];
  const currentTotal = round(currentWinner.total_cost_gbp);

  // ── SCENARIO 1 — Travel light ─────────────────────
  if (scenarioResults.light?.recommendation) {
    const w = scenarioResults.light.recommendation;
    const scenarioTotal = round(w.total_cost_gbp);
    const saving = currentTotal - scenarioTotal;
    const bagCost = round(
      currentWinner.cabin_bag_cost_gbp +
      currentWinner.checked_bag_cost_gbp
    );

    if (bagCost > 0) {
      results.push({
        lever:           'travel_light',
        locked_headline: 'Travel light — skip all bags',
        current_total:   currentTotal,
        scenario_total:  scenarioTotal,
        saving:          saving,
        flight_changes:  flightChanged(currentWinner, w),
        facts: {
          bag_saving:      Math.abs(saving),
          scenario_total:  scenarioTotal,
          scenario_carrier: cn(w.outbound_carrier),
          scenario_dates:  `${w.outbound_date} – ${w.return_date}`,
          flight_changes:  flightChanged(currentWinner, w),
        },
        url_params: {
          cabin_bags: '0',
          checked_bags: '0'
        },
      });
    } else {
      results.push({
        lever:           'travel_light',
        locked_headline: 'Travel light — no saving',
        current_total:   currentTotal,
        scenario_total:  scenarioTotal,
        saving:          0,
        flight_changes:  false,
        facts: {
          bag_saving:       0,
          scenario_total:   scenarioTotal,
          scenario_carrier: cn(w.outbound_carrier),
          bags_included:    true,
          flight_changes:   false,
        },
        url_params: {
          cabin_bags: '0',
          checked_bags: '0'
        },
      });
    }
  }

  // ── SCENARIO 2 — Add checked bag ──────────────────
  if (scenarioResults.checked?.recommendation) {
    const w = scenarioResults.checked.recommendation;
    const scenarioTotal = round(w.total_cost_gbp);
    const extraCost = scenarioTotal - currentTotal;
    const netDelta = Math.abs(extraCost);

    const expectedBagCost = round(params.firstCheckedBagGbp ?? 0) * 2;
    // The net delta can diverge from the raw bag fee once the extra bag
    // shifts the Uber-XL threshold — either adding a surcharge (net > bag
    // fee) or flipping the recommended transit mode and netting a saving
    // elsewhere (net < bag fee). Reconcile explicitly in one pre-written
    // body so the headline (always net) and body never show different
    // bases — that mismatch was the bug.
    const offsetAmount   = expectedBagCost > 0 ? expectedBagCost - netDelta : 0;
    const uberXlTriggered = offsetAmount < 0;
    const offsetIsSaving  = offsetAmount > 0;
    const uberXlDelta     = Math.abs(offsetAmount);

    const reconciledBody = uberXlTriggered
      ? `Adding one checked bag costs £${expectedBagCost} in bag fees — plus £${uberXlDelta} more because you'll now need a bigger taxi (Uber XL) to fit all the luggage. Net cost: £${netDelta} more, total £${scenarioTotal}.`
      : offsetIsSaving
      ? `Adding one checked bag costs £${expectedBagCost} in bag fees — but a standard taxi now fits everyone instead of the bigger Uber XL, saving £${uberXlDelta} on transit. Net cost: £${netDelta} more, total £${scenarioTotal}.`
      : `Adding one checked bag costs £${netDelta} more, total £${scenarioTotal}.`;

    results.push({
      lever:           'add_checked_bag',
      locked_headline: `Add checked bag — £${netDelta} more`,
      current_total:   currentTotal,
      scenario_total:  scenarioTotal,
      saving:          -extraCost,
      flight_changes:  flightChanged(currentWinner, w),
      facts: {
        extra_cost:      netDelta,
        scenario_total:  scenarioTotal,
        bags_added:      1,
        flight_changes:  flightChanged(currentWinner, w),
        scenario_carrier: cn(w.outbound_carrier),
        uber_xl_triggered: uberXlTriggered,
        bag_fee_cost:    expectedBagCost,
        uber_xl_delta:   uberXlDelta,
        reconciled_body: reconciledBody,
      },
      url_params: {
        checked_bags: String(params.checkedBags + 1)
      },
    });
  }

  // ── SCENARIO 3 — Transport flip ───────────────────
  if (scenarioResults.uber?.recommendation) {
    const w = scenarioResults.uber.recommendation;
    const scenarioTotal = round(w.total_cost_gbp);
    const diff = scenarioTotal - currentTotal;
    const isUberScenario = params.transitPreference !== 'uber';

    // Get Uber range for current winner
    const uberLow = round5(
      (currentWinner.outbound_transit?.uber?.low_pence ?? 0) / 100 +
      (currentWinner.return_transit?.uber?.low_pence ?? 0) / 100
    );
    const uberHigh = round5(
      (currentWinner.outbound_transit?.uber?.high_pence ?? 0) / 100 +
      (currentWinner.return_transit?.uber?.high_pence ?? 0) / 100
    );

    const originAirport = an(currentWinner.origin_iata);
    const destName = params.destinationName ?? currentWinner.out_dest_iata;

    results.push({
      lever: 'transport_flip',
      locked_headline: isUberScenario
        ? `Door-to-door both ends — £${Math.abs(diff)} ${diff > 0 ? 'more' : 'less'}`
        : diff < 0
          ? `Public transport saves £${Math.abs(diff)}`
          : `Public transport — £${diff} more`,
      current_total:  currentTotal,
      scenario_total: scenarioTotal,
      saving:         -diff,
      flight_changes: flightChanged(currentWinner, w),
      facts: {
        cost_diff:      Math.abs(diff),
        costs_more:     diff > 0,
        is_uber:        isUberScenario,
        uber_low:       uberLow,
        uber_high:      uberHigh,
        scenario_total: scenarioTotal,
        flight_changes: flightChanged(currentWinner, w),
        origin_airport: originAirport,
        destination_name: destName,
        outbound_departure_time: currentWinner.outbound_departure_time ?? null,
        current_total: currentTotal,
      },
      url_params: {
        transit: isUberScenario ? 'uber' : 'auto'
      },
    });
  }

  // ── SCENARIO 4 — Add seats ────────────────────────
  if (!params.seatsTogether &&
      scenarioResults.seats?.recommendation) {
    const w = scenarioResults.seats.recommendation;
    const scenarioTotal = round(w.total_cost_gbp);
    const extraCost = scenarioTotal - currentTotal;
    const seatCost = round(w.seat_cost_gbp);

    results.push({
      lever:           'add_seats',
      locked_headline: `Guaranteed seats — £${extraCost} more`,
      current_total:   currentTotal,
      scenario_total:  scenarioTotal,
      saving:          -extraCost,
      flight_changes:  flightChanged(currentWinner, w),
      facts: {
        extra_cost:      extraCost,
        seat_cost:       seatCost,
        scenario_total:  scenarioTotal,
        flight_changes:  flightChanged(currentWinner, w),
        caveat: 'Without selection you may not sit together — airlines try but cannot guarantee it.',
      },
      url_params: { seats: 'true' },
    });
  }

  // ── SCENARIO 5 — All public transport ──────────────
  if (params.transitPreference !== 'transit' &&
      scenarioResults.transit?.recommendation) {
    const w = scenarioResults.transit.recommendation;
    const scenarioTotal = round(w.total_cost_gbp);
    const diff = scenarioTotal - currentTotal;

    results.push({
      lever: 'transport_all_transit',
      locked_headline: diff < 0
        ? `All public transport — saves £${Math.abs(diff)}`
        : diff > 0
          ? `All public transport — £${diff} more`
          : 'All public transport — same cost',
      current_total:  currentTotal,
      scenario_total: scenarioTotal,
      saving:         -diff,
      flight_changes: flightChanged(currentWinner, w),
      facts: {
        delta:          Math.abs(diff),
        costs_more:     diff > 0,
        saves_money:    diff < 0,
        scenario_total: scenarioTotal,
        flight_changes: flightChanged(currentWinner, w),
        outbound_departure_time: currentWinner.outbound_departure_time ?? null,
      },
      url_params: { transit: 'transit' },
    });
  }

  return results;
}
