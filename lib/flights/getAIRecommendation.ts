import Anthropic from '@anthropic-ai/sdk';
import { combinationKey, type ScoredCombination } from './buildCandidates';
import { selectCombination, type SelectionContext } from './selectCombination';
import type { ScenarioResult } from './buildScenarioResults';
import { narratePriceMovement } from './priceMovementNarration';
import { BASELINE_NAME } from './copyConstants';

export interface AIRecommendationOutput {
  problem_statement: string;
  headline: string;
  subheadline: string;
  recommendation_prose: string;
  lever_insights: Array<{
    lever: string;
    headline?: string;
    insight: string;
    verified_field: string;
    verified_value: string | number | boolean;
    saving_gbp?: number | null;
    obvious?: string;
    optimal?: string;
  }>;
  caveats: string[];
  confidence: 'high' | 'medium' | 'low';
  fallback: boolean;
  winner_outbound_date?:    string;
  winner_return_date?:      string;
  winner_outbound_carrier?: string;
  winner_absence_days?:     number;
  winner_fine_gbp?:         number;
  winner_fine_wipes_saving?: boolean;
  right_column_cards?: Array<{
    lever: string;
    headline?: string;
    insight: string;
    verified_field: string;
    verified_value: string | number | boolean;
    saving_gbp: number | null;
  }>;
  scenario_insights?: Array<{
    lever:   string;
    insight: string;
  }>;
  // Raw price-history data for the "How this price has moved" card's chart —
  // the card's narrated text lives in lever_insights like any other card;
  // this is the numeric series the expand/collapse bar chart renders from.
  price_movement?: {
    checks_total:     number;
    checks_with_data: number;
    price_points:     Array<{ checked_on: string; total_gbp: number }>;
    direction:        'up' | 'down' | 'flat' | 'single_point' | 'no_data';
  };
}

export interface FamilyContext {
  schoolName: string | null;
  borough: string | null;
  postcodeDistrict: string | null;
  windowStart: string;
  windowEnd: string;
  adults: number;
  children: number;
  infants: number;
  cabinBags: number;
  checkedBags: number;
  seatsTogether: boolean;
  benchmarkCost: number | null; // pre-computed typical Saturday booking cost
  destinationName?: string | null;
  transitPreference?: 'auto' | 'uber' | 'transit' | null;
  scenarios?: ScenarioResult[];
  savingCategory: 'significant' | 'found_saving' | 'baseline_cheapest';
  combinationCount: number;
  // Distinct (outbound_date, return_date) pairs among combinationCount —
  // i.e. how many cells the date matrix actually shows, computed the same
  // way as its own cellMap (page.tsx). Multiple carrier/airport
  // combinations can share one cell, which is why this is always <=
  // combinationCount, often by a lot.
  distinctDatePairs: number;
  // Fine/absence-aware warning fields — computed in assembleRecommendation.ts
  absence_days: number;
  absence_out_days: number; // departure before the window opens
  absence_ret_days: number; // return after the window closes
  term_resume_date: string; // day after window_end, formatted "Monday 3 Nov"
  fine_gbp: number;
  fine_wipes_saving: boolean;
  net_cost_with_fine: number;  // winner total + fine
  net_delta_with_fine: number; // net_cost - baseline_allin, positive = worse off
  // Best alternative option (avoids the fine when the winner has one,
  // otherwise just the runner-up) — computed in assembleRecommendation.ts
  alt_total_cost: number | null;
  alt_outbound_carrier: string | null; // IATA code — humanised at render time
  alt_return_carrier: string | null;   // IATA code — humanised at render time
  alt_origin_iata: string | null;
  alt_outbound_date_formatted: string | null;
  alt_return_date_formatted: string | null;
  alt_absence_days: number | null;
  alt_delta_vs_winner: number | null; // alt_total - winner_total, positive = more expensive
  alt_has_fine: boolean;
  alt_ret_dep_time: string | null;
  alt_arr_q: string | null;
  // Quality context for the "why this over the alternatives" card.
  // Winner fields duplicate what's already on `recommended` inside
  // getAIRecommendation, but are threaded through FamilyContext too since
  // this is the shape assembleRecommendation.ts hands off.
  winner_out_dep_time: string;
  winner_out_dep_quality: string;
  winner_arr_time: string;
  winner_arr_quality: string;
  winner_ret_dep_time: string;
  winner_ret_dep_quality: string;
  // baseline_out_dep_quality / baseline_arr_quality / baseline_out_arr_time
  // already exist below — only the baseline's departure *time* was missing.
  baseline_out_dep_time?: string;
  // Best alternative quality — alt_arr_q / alt_ret_dep_time already exist
  // above; these fill in the outbound side and the return quality tier
  // needed by the departure/return contrast logic.
  alt_out_dep_quality: string | null;
  alt_out_dep_time: string | null;
  alt_arr_time: string | null;
  alt_ret_dep_quality: string | null;
  // Pre-computed single most meaningful quality contrast — see
  // winner_quality_advantage derivation in assembleRecommendation.ts.
  winner_quality_advantage: string;
  trueCheapest_total_cost?:  number;
  trueCheapest_trip_nights?: number;
  trueCheapest_outbound?:    string;
  trueCheapest_return?:      string;
  trueCheapest_carrier?:     string;
  baseline_eff_cost?:        number;
  baseline_out_dep_quality?: string;
  baseline_fare?:            number;
  baseline_allin?:           number;
  baseline_ret_dep_time?:    string;
  baseline_airport_name?:    string;
  baseline_arr_quality?:     string;
  baseline_ret_dep_quality?: string;
  baseline_out_arr_time?:    string;
  baseline_ret_arr_time?:    string;
  baseline_origin_iata?:     string;
  baseline_dest_iata?:       string;
  baseline_outbound_date?:   string;
  baseline_return_date?:     string;
  baseline_trip_nights?:     number;
  baseline_carrier?:         string;
  baseline_out_transit_mode?: string;
  baseline_ret_transit_mode?: string;
  // Best inset option from the full scored pool (not limited to shortlist)
  bestInsetFromPool?: {
    outbound_date: string;
    return_date: string;
    outbound_departure_time: string | null;
    return_departure_time: string | null;
    total_cost_gbp: number;
    trip_nights: number;
    arrival_quality: string | null;
    outbound_carrier: string;
    return_carrier: string;
    origin_iata: string;
    out_dest_iata: string;
  } | null;
  lcc_cabin_bag_min_fee?: number;
  lcc_cabin_bag_max_fee?: number;
  partySize?: number;
  // Price-history for the exact recommended itinerary (both legs), from
  // get_price_movement — computed in route.ts via computePriceMovement().
  // Optional: assembleRecommendation.ts (the unused legacy path — see
  // CLAUDE.md) doesn't populate these, so the price_movement card degrades
  // to its 'no_data' phrasing rather than being required everywhere.
  price_checks_total?: number;
  price_checks_with_data?: number;
  price_points?: Array<{ checked_on: string; total_gbp: number }>;
  price_latest_total_gbp?: number | null;
  price_previous_total_gbp?: number | null;
  price_delta_gbp?: number | null;
  price_direction?: 'up' | 'down' | 'flat' | 'single_point' | 'no_data';
  price_first_checked_on?: string | null;
  price_first_total_gbp?: number | null;
  price_total_change_gbp?: number | null;
}

interface CardSpec {
  lever: string;
  headline_hint: string;
  voice: string;
  facts: Record<string, string | number | boolean | null>;
  verified_field: string;
  verified_value: string | number | boolean;
  saving_gbp: number | null;
  obvious?: string;
  optimal?: string;
}

export async function getAIRecommendation(
  combinations: ScoredCombination[],
  context: FamilyContext,
  selectionContext?: SelectionContext | null,
  scoredPool?: ScoredCombination[],
): Promise<AIRecommendationOutput> {

  const FALLBACK: AIRecommendationOutput = {
    problem_statement: '',
    headline: 'We found the best value option for your dates.',
    subheadline: '',
    recommendation_prose: 'We found the best value option for your dates.',
    lever_insights: [],
    caveats: [],
    confidence: 'low',
    fallback: true,
  };

  if (!combinations.length) return FALLBACK;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  console.log('[getAIRecommendation] function entered');
  console.log('[getAIRecommendation] API key status:',
    !apiKey ? 'missing' :
    apiKey === 'your_api_key_here' ? 'placeholder' :
    'present, length: ' + apiKey.length
  );
  if (!apiKey || apiKey === 'your_api_key_here') return FALLBACK;

  console.log('[getAIRecommendation] combinations count:', combinations.length);

  const client = new Anthropic({ apiKey });

  // ── Build compact combinations for prompt ─────────────────────────────────
  // ScoredCombination already has quality fields from buildCandidates.ts —
  // no need to recompute them here.
  const combinationsForPrompt = combinations.map((c, i) => ({
    index: i,
    outbound_date: c.outbound_date,
    return_date: c.return_date,
    origin_iata: c.origin_iata,
    out_dest_iata: c.out_dest_iata,
    ret_dest_iata: c.ret_dest_iata,
    outbound_carrier: c.outbound_carrier,
    return_carrier: c.return_carrier,
    split_carrier: c.split_carrier,
    outbound_departure_time: c.outbound_departure_time,
    outbound_arrival_time: c.outbound_arrival_time,
    outbound_duration_mins: c.outbound_duration_mins,
    return_departure_time: c.return_departure_time,
    return_arrival_time: c.return_arrival_time,
    is_inset_day: c.is_inset_day,
    requires_absence: c.requires_absence,
    absence_days: c.absence_days,
    fine_gbp: c.fine_gbp,
    cabin_bag_cost_gbp: c.cabin_bag_cost_gbp,
    // Per-leg bag costs (new — helps AI reason about carrier-specific bag charges)
    outbound_cabin_bag_cost_gbp: c.outbound_cabin_bag_cost_gbp,
    return_cabin_bag_cost_gbp: c.return_cabin_bag_cost_gbp,
    checked_bag_cost_gbp: c.checked_bag_cost_gbp,
    seat_cost_gbp: c.seat_cost_gbp,
    outbound_transit_cost_gbp: c.outbound_transit_cost_gbp,
    outbound_transit_route: c.outbound_transit?.transit?.route_summary ?? null,
    outbound_transit_duration_mins: c.outbound_transit?.transit?.duration_mins ?? null,
    outbound_transit_changes: c.outbound_transit?.transit?.changes ?? null,
    outbound_uber_cost_gbp: c.outbound_transit?.uber?.mean_pence
      ? Math.round(c.outbound_transit.uber.mean_pence / 100) : null,
    outbound_uber_low_gbp: c.outbound_transit?.uber?.low_pence
      ? Math.round(c.outbound_transit.uber.low_pence / 100) : null,
    outbound_uber_high_gbp: c.outbound_transit?.uber?.high_pence
      ? Math.round(c.outbound_transit.uber.high_pence / 100) : null,
    outbound_uber_duration_mins: c.outbound_transit?.uber?.duration_mins ?? null,
    outbound_early_warning: c.outbound_transit?.transit?.early_flight_warning ?? false,
    return_transit_cost_gbp: c.return_transit_cost_gbp,
    return_transit_route: c.return_transit?.transit?.route_summary ?? null,
    return_transit_mode: c.return_transit?.recommended_mode ?? null,
    return_transit_changes: c.return_transit?.transit?.changes ?? null,
    return_uber_cost_gbp: c.return_transit?.uber?.mean_pence
      ? Math.round(c.return_transit.uber.mean_pence / 100) : null,
    return_uber_low_gbp: c.return_transit?.uber?.low_pence
      ? Math.round(c.return_transit.uber.low_pence / 100) : null,
    return_uber_high_gbp: c.return_transit?.uber?.high_pence
      ? Math.round(c.return_transit.uber.high_pence / 100) : null,
    destination_transfer_cost_gbp: c.destination_transfer_cost_gbp,
    destination_transit_duration_mins: c.destination_transit_duration_mins ?? null,
    baggage_is_estimate: c.baggage_is_estimate,
    total_cost_gbp: c.total_cost_gbp,
    total_inc_fine: c.total_inc_fine,
    outbound_fare_gbp: c.outbound_fare_gbp,
    return_fare_gbp:   c.return_fare_gbp,
    // Pre-computed quality fields from buildCandidates.ts — use directly
    trip_nights: c.trip_nights,
    arrival_quality: c.arrival_quality,
    outbound_departure_quality: c.outbound_departure_quality,
    return_departure_quality: c.return_departure_quality,
    total_outbound_travel_mins: c.total_outbound_travel_mins,
    pre_score: c.pre_score,
  }));

  // ── Selection (deterministic — no LLM call) ───────────────────────
  const ctx = selectionContext ?? selectCombination(combinations);
  if (!ctx) return FALLBACK;

  const confidence: 'high' | 'medium' | 'low' = 'high';

  // Winner is pre-determined by selectCombination.
  // AI receives it as context and writes copy only — never re-derives winner.
  // When baseline wins, it's excluded from the shortlist, so build recommended
  // directly from the winner (which IS the baseline in the scored pool).
  const recommended = (() => {
    const found = combinationsForPrompt.find(c =>
      c.outbound_date    === ctx.winner.outbound_date &&
      c.return_date      === ctx.winner.return_date &&
      c.origin_iata      === ctx.winner.origin_iata &&
      c.outbound_carrier === ctx.winner.outbound_carrier &&
      c.return_carrier   === ctx.winner.return_carrier
    );
    if (found) return found;
    // Baseline winner not in shortlist — build same shape from ctx.winner
    const w = ctx.winner;
    return {
      index: 0,
      outbound_date: w.outbound_date,
      return_date: w.return_date,
      origin_iata: w.origin_iata,
      out_dest_iata: w.out_dest_iata,
      ret_dest_iata: w.ret_dest_iata,
      outbound_carrier: w.outbound_carrier,
      return_carrier: w.return_carrier,
      split_carrier: w.split_carrier,
      outbound_departure_time: w.outbound_departure_time,
      outbound_arrival_time: w.outbound_arrival_time,
      outbound_duration_mins: w.outbound_duration_mins,
      return_departure_time: w.return_departure_time,
      return_arrival_time: w.return_arrival_time,
      is_inset_day: w.is_inset_day,
      requires_absence: w.requires_absence,
      absence_days: w.absence_days,
      fine_gbp: w.fine_gbp,
      cabin_bag_cost_gbp: w.cabin_bag_cost_gbp,
      outbound_cabin_bag_cost_gbp: w.outbound_cabin_bag_cost_gbp,
      return_cabin_bag_cost_gbp: w.return_cabin_bag_cost_gbp,
      checked_bag_cost_gbp: w.checked_bag_cost_gbp,
      seat_cost_gbp: w.seat_cost_gbp,
      outbound_transit_cost_gbp: w.outbound_transit_cost_gbp,
      outbound_transit_route: w.outbound_transit?.transit?.route_summary ?? null,
      outbound_transit_duration_mins: w.outbound_transit?.transit?.duration_mins ?? null,
      outbound_transit_changes: w.outbound_transit?.transit?.changes ?? null,
      outbound_uber_cost_gbp: w.outbound_transit?.uber?.mean_pence
        ? Math.round(w.outbound_transit.uber.mean_pence / 100) : null,
      outbound_uber_low_gbp: w.outbound_transit?.uber?.low_pence
        ? Math.round(w.outbound_transit.uber.low_pence / 100) : null,
      outbound_uber_high_gbp: w.outbound_transit?.uber?.high_pence
        ? Math.round(w.outbound_transit.uber.high_pence / 100) : null,
      outbound_uber_duration_mins: w.outbound_transit?.uber?.duration_mins ?? null,
      outbound_early_warning: w.outbound_transit?.transit?.early_flight_warning ?? false,
      return_transit_cost_gbp: w.return_transit_cost_gbp,
      return_transit_route: w.return_transit?.transit?.route_summary ?? null,
      return_transit_mode: w.return_transit?.recommended_mode ?? null,
      return_transit_changes: w.return_transit?.transit?.changes ?? null,
      return_uber_cost_gbp: w.return_transit?.uber?.mean_pence
        ? Math.round(w.return_transit.uber.mean_pence / 100) : null,
      return_uber_low_gbp: w.return_transit?.uber?.low_pence
        ? Math.round(w.return_transit.uber.low_pence / 100) : null,
      return_uber_high_gbp: w.return_transit?.uber?.high_pence
        ? Math.round(w.return_transit.uber.high_pence / 100) : null,
      destination_transfer_cost_gbp: w.destination_transfer_cost_gbp,
      destination_transit_duration_mins: w.destination_transit_duration_mins ?? null,
      baggage_is_estimate: w.baggage_is_estimate,
      total_cost_gbp: w.total_cost_gbp,
      total_inc_fine: w.total_inc_fine,
      outbound_fare_gbp: w.outbound_fare_gbp,
      return_fare_gbp: w.return_fare_gbp,
      trip_nights: w.trip_nights,
      arrival_quality: w.arrival_quality,
      outbound_departure_quality: w.outbound_departure_quality,
      return_departure_quality: w.return_departure_quality,
      total_outbound_travel_mins: w.total_outbound_travel_mins,
      pre_score: w.pre_score,
    };
  })();

  // ── Helpers ──────────────────────────────────────────────────────────
  const round = (n: number) => Math.round(n);
  const round5 = (n: number) => Math.round(n / 5) * 5;
  const destinationName = context.destinationName ?? recommended.out_dest_iata;

  const QORDER = ['poor', 'acceptable', 'good', 'excellent'];

  const arrivalProblem = (q: string | null, t: string | null): string | null => {
    if (q === 'poor')       return t ? `lands near midnight (${t})` : 'lands near midnight';
    if (q === 'acceptable') return t ? `lands late (${t})` : 'lands late in the evening';
    return null;
  };

  const depProblem = (q: string | null, t: string | null): string | null => {
    if (q === 'poor' || q === 'very_early')
      return t ? `departs at ${t}` : 'departs very early';
    return null;
  };

  const CARRIER_NAMES: Record<string, string> = {
    BA: 'British Airways',
    U2: 'easyJet',
    FR: 'Ryanair',
    W6: 'Wizz Air',
    VY: 'Vueling',
    TP: 'TAP Air Portugal',
    EI: 'Aer Lingus',
  };
  const cn = (iata: string) => CARRIER_NAMES[iata] ?? iata;
  const AIRPORT_NAMES: Record<string, string> = {
    LHR: 'Heathrow', LGW: 'Gatwick', STN: 'Stansted',
    LTN: 'Luton', LCY: 'City', SEN: 'Southend',
  };
  const an = (iata: string) => AIRPORT_NAMES[iata] ?? iata;
  const simplifyRoute = (route: string | null): string => {
    if (!route) return 'public transport';
    const operators = route
      .split('→')
      .map(s => s.trim())
      .filter(s =>
        s.match(/Line|Express|Rail|Bus|Coach|National/i) &&
        !s.match(/\d+min/)
      )
      .map(s => s.replace(/\s*\(.*?\)/g, '').trim())
      .filter((s, i, arr) => arr.indexOf(s) === i);
    if (!operators.length) return 'public transport';
    if (operators.length === 1) return operators[0];
    return operators.slice(0, -1).join(', ') + ' and ' + operators[operators.length - 1];
  };

  const fmtD = (iso: string): string => {
    const d = new Date(iso + 'T00:00:00');
    const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun',
                    'Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  };

  // Long-form date (weekday spelled out) — used by the inset-day option card.
  const fmtDLong = (iso: string): string => {
    const d = new Date(iso + 'T00:00:00');
    const dayName = d.toLocaleDateString('en-GB', { weekday: 'long' });
    return `${dayName} ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`;
  };

  // Hotel checkout window: 2h30m–2h00m before departure, rounded to 5 min.
  const checkoutWindowFor = (depTimeHHMM: string | null | undefined): { from: string; to: string } => {
    if (!depTimeHHMM) return { from: '', to: '' };
    const [dh, dm] = depTimeHHMM.split(':').map(Number);
    const totalMins = dh * 60 + dm;
    const fmt5 = (m: number) => {
      const wrapped = ((m % 1440) + 1440) % 1440;
      return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
    };
    return {
      from: fmt5(Math.round((totalMins - 150) / 5) * 5),
      to:   fmt5(Math.round((totalMins - 120) / 5) * 5),
    };
  };

  const cards: CardSpec[] = [];

  // ── Find reference combinations ───────────────────────────────────────
  const viableCombos = combinationsForPrompt.filter(
    c => !c.requires_absence &&
         c.arrival_quality !== 'poor' &&
         c.outbound_departure_quality !== 'poor' &&
         c.trip_nights >= 1
  );

  const cheapestOverall = context.trueCheapest_total_cost
    ? {
        total_cost_gbp:   context.trueCheapest_total_cost,
        total_inc_fine:   context.trueCheapest_total_cost,
        trip_nights:      context.trueCheapest_trip_nights ?? recommended.trip_nights,
        outbound_date:    context.trueCheapest_outbound    ?? recommended.outbound_date,
        return_date:      context.trueCheapest_return      ?? recommended.return_date,
        outbound_carrier: context.trueCheapest_carrier     ?? recommended.outbound_carrier,
        return_carrier:   recommended.return_carrier,
        origin_iata:      recommended.origin_iata,
        out_dest_iata:    recommended.out_dest_iata,
        is_inset_day:     false,
        requires_absence: false,
        arrival_quality:  recommended.arrival_quality,
      }
    : viableCombos.reduce((best, c) =>
        c.total_cost_gbp < best.total_cost_gbp ? c : best
      , viableCombos[0]);

  const winnerIsCheapest =
    recommended.outbound_date === cheapestOverall?.outbound_date &&
    recommended.return_date   === cheapestOverall?.return_date;

  // How much more/less than baseline (benchmark cost)?
  const baselineDiff = context.benchmarkCost != null
    ? round(recommended.total_cost_gbp - context.benchmarkCost)
    : null;

  // How much more than trueCheapest (for value_tradeoff card only)
  const cheapestDiff = round(
    recommended.total_cost_gbp - cheapestOverall.total_cost_gbp
  );

  // ── Saving category helpers ───────────────────────────────────────────
  const isSignificant = context.savingCategory === 'significant';
  const isFoundSaving = context.savingCategory === 'found_saving';
  const isBaselineCheapest = context.savingCategory === 'baseline_cheapest';

  const combCount = context.combinationCount > 0
    ? `${context.combinationCount}`
    : '100';

  // ── Fine/absence-aware warning fields (pre-computed in assembleRecommendation.ts) ─
  const absenceDays     = context.absence_days ?? 0;
  const fineGbp          = context.fine_gbp ?? 0;
  const fineWipesSaving  = context.fine_wipes_saving ?? false;
  const netCostWithFine  = context.net_cost_with_fine  ?? round(recommended.total_cost_gbp);
  const netDeltaWithFine = context.net_delta_with_fine ?? 0;

  // ── Price movement card — separate dedicated call, its own system prompt ──
  // Scoped to significant/found_saving only (see CLAUDE.md card-set section).
  // Kicked off here, before the cards below are even built, so it runs
  // concurrently with the main insight call rather than adding serial
  // latency — awaited together in the Promise.all further down.
  const priceDirection = context.price_direction ?? 'no_data';
  const pricePointsForMovement = context.price_points ?? [];
  // Not sent to the AI or used by this card's rendering (the "never been
  // cheaper" takeaway is itinerary-card-specific UI in
  // price-history-section.tsx) — computed here only to satisfy
  // narratePriceMovement's shared PriceMovementComputed type.
  const isPriceMovementCurrentLowest = pricePointsForMovement.length > 0
    && (context.price_latest_total_gbp ?? Infinity) === Math.min(...pricePointsForMovement.map(p => Math.round(p.total_gbp)));
  const priceMovementNarrationPromise: Promise<string> = isBaselineCheapest
    ? Promise.resolve('')
    : narratePriceMovement({
        checks_total:       context.price_checks_total ?? 0,
        checks_with_data:   context.price_checks_with_data ?? 0,
        price_points:       pricePointsForMovement,
        latest_total_gbp:   context.price_latest_total_gbp ?? null,
        previous_total_gbp: context.price_previous_total_gbp ?? null,
        delta_gbp:          context.price_delta_gbp ?? null,
        direction:          priceDirection,
        first_checked_on:   context.price_first_checked_on ?? null,
        first_total_gbp:    context.price_first_total_gbp ?? null,
        total_change_gbp:   context.price_total_change_gbp ?? null,
        is_current_lowest:  isPriceMovementCurrentLowest,
      });

  // ── Winner vs best-inset-in-pool identity check ─────────────────────────
  const winnerKey = combinationKey(recommended);
  const insetFromPool = context.bestInsetFromPool ?? null;
  const insetKey = insetFromPool
    ? combinationKey({
        outbound_date:    insetFromPool.outbound_date,
        return_date:      insetFromPool.return_date,
        origin_iata:      insetFromPool.origin_iata,
        out_dest_iata:    insetFromPool.out_dest_iata,
        outbound_carrier: insetFromPool.outbound_carrier,
        return_carrier:   insetFromPool.return_carrier,
      })
    : null;
  const winnerIsInsetOption = insetKey !== null && insetKey === winnerKey;
  const showInsetCard = insetFromPool !== null && !winnerIsInsetOption &&
    insetFromPool.total_cost_gbp < recommended.total_cost_gbp;

  // ── LEAD CARD — only when no inset day ───────────────────────────────
  if (!recommended.is_inset_day) {
    if (isBaselineCheapest) {
      cards.push({
        lever: 'lead_research',
        headline_hint: `${combCount} combinations checked`,
        voice: `Copy the sentence from facts VERBATIM. Assembly only.`,
        facts: {
          locked_headline:      `${combCount} combinations checked`,
          sentence_1:           `We checked ${combCount} date, carrier, and airport combinations for ${destinationName} this half-term. The ${cn(context.baseline_carrier ?? 'BA')} direct from ${context.baseline_airport_name ?? 'Heathrow'} — the closest airport to your school — came out on top.`,
          combination_count:    combCount,
          is_baseline_cheapest: isBaselineCheapest,
        },
        verified_field: 'total_cost_gbp',
        verified_value:  round(recommended.total_cost_gbp),
        saving_gbp: null,
      });
    } else {
      const benchSaving = context.benchmarkCost != null
        ? round(context.benchmarkCost - recommended.total_cost_gbp)
        : null;
      if (benchSaving != null && benchSaving > 0) {
        cards.push({
          lever: 'lead_saving',
          headline_hint: `£${benchSaving} less than typical`,
          voice: `One sentence leading with what we found: £${benchSaving} less than the typical booking for the same destination and window. Include total cost £${round(recommended.total_cost_gbp)}. Do not mention airports or carriers here — that comes in later cards.`,
          facts: {
            locked_headline: `£${benchSaving} less than typical`,
            saving:          benchSaving,
            total:           round(recommended.total_cost_gbp),
          },
          verified_field: 'total_cost_gbp',
          verified_value:  round(recommended.total_cost_gbp),
          saving_gbp: benchSaving,
        });
      }
    }
  }

  // ── SELECTION STORY CARD ──────────────────────────────────────────────
  // Computed after splitSaving and allInTrap are available — inserted here
  // as a placeholder; pushed after those vars are set below.

  // ── CARD 1 — value_tradeoff ───────────────────────────────────────────
  if (!winnerIsCheapest && cheapestOverall) {
    const diff = round(recommended.total_cost_gbp - cheapestOverall.total_cost_gbp);
    const nightsGained = recommended.trip_nights - cheapestOverall.trip_nights;
    const gains: string[] = [];
    if (nightsGained > 0)
      gains.push(`${nightsGained} more night${nightsGained > 1 ? 's' : ''} in ${destinationName}`);
    if (recommended.is_inset_day && !cheapestOverall.is_inset_day)
      gains.push('the inset-day departure');
    if (
      QORDER.indexOf(recommended.arrival_quality ?? '') >
      QORDER.indexOf(cheapestOverall.arrival_quality ?? '')
    )
      gains.push('a daytime arrival');

    cards.push({
      lever: 'value_tradeoff',
      headline_hint: nightsGained > 0
        ? `Extra night for £${diff} more`
        : `Better value for £${diff} more`,
      voice: `HEADLINE MUST BE EXACTLY: "${nightsGained > 0
        ? `An extra night for £${diff} more`
        : `Better timing for £${diff} more`}"

Copy cheapest_description and winner_description from facts VERBATIM.

Write exactly two sentences:
1. "The cheapest option — [cheapest_description] — gives [cheapest_nights] nights on a standard half-term departure day."
2. "For £[extra_cost] more, [winner_description] [what_it_buys]."

Copy descriptions exactly. No airlines. No airports.`,
      facts: {
        locked_headline:      nightsGained > 0
          ? `An extra night for £${diff} more`
          : `Better timing for £${diff} more`,
        cheapest_description: `${fmtD(cheapestOverall.outbound_date)}–${fmtD(cheapestOverall.return_date)} at £${round(cheapestOverall.total_cost_gbp)}`,
        cheapest_nights:      cheapestOverall.trip_nights,
        winner_description:   `${fmtD(recommended.outbound_date)}–${fmtD(recommended.return_date)} at £${round(recommended.total_inc_fine)}`,
        winner_nights:        recommended.trip_nights,
        extra_cost:           diff,
        what_it_buys:         gains.join(' and ') || 'better timing',
      },
      verified_field: 'total_inc_fine',
      verified_value:  round(recommended.total_inc_fine),
      saving_gbp: null,
    });
  }

  // ── CARD 3 — inset_value ──────────────────────────────────────────────
  const bestNonInset = viableCombos
    .filter(c => !c.is_inset_day)
    .sort((a, b) => a.total_inc_fine - b.total_inc_fine)[0] ?? null;

  const insetAddsNight = recommended.is_inset_day &&
    bestNonInset != null &&
    recommended.trip_nights > bestNonInset.trip_nights;

  if (
    recommended.is_inset_day &&
    (recommended.arrival_quality === 'excellent' ||
     recommended.arrival_quality === 'good')
  ) {
    cards.push({
      lever: 'inset_day',
      headline_hint: 'Inset day, no absence',
      voice: insetAddsNight
        ? `CRITICAL: Lead with the discovery — the parent almost certainly does not know their school has an inset day. First sentence must reveal it.

Format: "${context.schoolName ?? 'Your school'} has an inset day on [date] — most families don't know this. It means you can fly a day early, gain a full extra night in ${destinationName}, with zero school absence and zero fine."

Use outbound_date from facts for the date.
MUST include: school name, inset date, extra night, zero absence, zero fine.
One sentence. 25 words max. Cut ruthlessly.`
        : `CRITICAL: Lead with the discovery — the parent almost certainly does not know their school has an inset day. First sentence must reveal it.

Format: "${context.schoolName ?? 'Your school'} has an inset day on [date] — flying on it means quieter airports, a [arrival_time] arrival, zero absence and zero fine."

Do NOT claim an extra night — it does not add one.
MUST include: school name, inset date, zero absence.
One sentence. 25 words max.`,
      facts: {
        inset_date:       (() => {
          const d = new Date(recommended.outbound_date + 'T00:00:00');
          const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
          const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun',
                          'Jul','Aug','Sep','Oct','Nov','Dec'];
          return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
        })(),
        locked_headline:  'Inset day, no absence',
        school:           context.schoolName ?? 'your school',
        adds_extra_night: insetAddsNight,
        arrival_time:     recommended.outbound_arrival_time,
        destination:      destinationName,
      },
      verified_field: 'is_inset_day',
      verified_value:  true,
      saving_gbp: null,
    });
  }

  // ── MONEY LEVERS (max 3) ──────────────────────────────────────────────
  const moneyCards: CardSpec[] = [];

  // Travel light is shown in the scenario strip when bag costs exist —
  // suppress from left strip to avoid redundancy.
  const SUPPRESS_TRAVEL_LIGHT_IN_STRIP = true;

  // Cabin bags
  if ((recommended.cabin_bag_cost_gbp ?? 0) > 0 &&
      !SUPPRESS_TRAVEL_LIGHT_IN_STRIP) {
    const outCost = recommended.outbound_cabin_bag_cost_gbp ?? 0;
    const retCost = recommended.return_cabin_bag_cost_gbp ?? 0;
    const total   = round(recommended.cabin_bag_cost_gbp ?? 0);
    moneyCards.push({
      lever: 'travel_light',
      headline_hint: 'The personal item hack',
      voice: outCost > 0 && retCost > 0
        ? `Lead with the action and saving, not the cost statement. Format: "Pack personal items only on [leg(s)] and save £[amount] — [reason why that leg charges]." Never start with "Packing to personal items" (passive). Always start with "Pack" (imperative) or "Save £X by packing" (saving-first). Frame as a hack, not a cost. "Pack personal items only and save £${total} — outbound cabin bag costs £${round(outCost)}, return costs £${round(retCost)}." Punchy, one sentence.`
        : outCost === 0
          ? `Lead with the action and saving, not the cost statement. Format: "Pack personal items only on [leg(s)] and save £[amount] — [reason why that leg charges]." Never start with "Packing to personal items" (passive). Always start with "Pack" (imperative) or "Save £X by packing" (saving-first). The outbound is free but the return charges £${round(retCost)} for cabin bags — pack to personal items only on the return and save £${round(retCost)}. One sentence.`
          : `Lead with the action and saving, not the cost statement. Format: "Pack personal items only on [leg(s)] and save £[amount] — [reason why that leg charges]." Never start with "Packing to personal items" (passive). Always start with "Pack" (imperative) or "Save £X by packing" (saving-first). The outbound charges £${round(outCost)} for cabin bags but the return is free — pack to personal items only outbound and save £${round(outCost)}. One sentence.`,
      facts: {
        locked_headline:   'The personal item hack',
        outbound_bag_cost: round(outCost),
        return_bag_cost:   round(retCost),
        total_bag_cost:    total,
      },
      verified_field: 'cabin_bag_cost_gbp',
      verified_value:  total,
      saving_gbp: total,
    });
  }

  // Split carrier
  const splitSaving = (() => {
    const sameDates = combinationsForPrompt.filter(
      c => c.outbound_date === recommended.outbound_date &&
           c.return_date   === recommended.return_date
    );
    const cheapestSplit  = sameDates.filter(c =>  c.split_carrier)
      .sort((a, b) => a.total_cost_gbp - b.total_cost_gbp)[0];
    const cheapestSingle = sameDates.filter(c => !c.split_carrier)
      .sort((a, b) => a.total_cost_gbp - b.total_cost_gbp)[0];
    if (!cheapestSplit || !cheapestSingle) return null;
    const saving = round(cheapestSingle.total_cost_gbp - cheapestSplit.total_cost_gbp);
    return saving >= 40 ? {
      saving,
      outCarrier: cheapestSplit.outbound_carrier,
      retCarrier: cheapestSplit.return_carrier,
      singleCarrier: cheapestSingle.outbound_carrier,
    } : null;
  })();

  // split_carrier pushed after allInTrap is computed — see below

  // All-in trap: lower headline fare but higher all-in cost than winner
  // Uses the full scored pool (128+ combos), not the shortlist
  const allInTrap = (() => {
    const pool = scoredPool ?? [];
    if (!pool.length) return null;

    const winnerBaseFare = (recommended.outbound_fare_gbp ?? 0) + (recommended.return_fare_gbp ?? 0);
    const winnerAllin = round(recommended.total_cost_gbp);

    // Find candidates: lower base fare than winner, but higher all-in, saving >= £50
    const candidates = pool.filter(c => {
      if ((c as any).is_baseline) return false;
      const baseFare = (c.outbound_fare_gbp ?? 0) + (c.return_fare_gbp ?? 0);
      const allinDiff = round(c.total_cost_gbp) - winnerAllin;
      return baseFare < winnerBaseFare && allinDiff >= 50;
    });

    if (!candidates.length) return null;

    // Pick the most dramatic trap — highest all-in saving
    const trapCombo = candidates.reduce((best, c) =>
      round(c.total_cost_gbp) - winnerAllin >
      round(best.total_cost_gbp) - winnerAllin ? c : best
    , candidates[0]);

    const trapBaseFare = round((trapCombo.outbound_fare_gbp ?? 0) + (trapCombo.return_fare_gbp ?? 0));
    const trapAllin = round(trapCombo.total_cost_gbp);
    const allinDiff = trapAllin - winnerAllin;
    const cheapDestTransfer = round(trapCombo.destination_transfer_cost_gbp ?? 0);
    const hasExpensiveTransfer = cheapDestTransfer > 50;

    return {
      cheap_description:      `${cn(trapCombo.outbound_carrier)} from ${trapCombo.origin_iata} on ${fmtD(trapCombo.outbound_date)}, returning ${fmtD(trapCombo.return_date)}`,
      cheap_fare:             trapBaseFare,
      cheap_allin:            trapAllin,
      cheap_dest_transfer:    cheapDestTransfer,
      cheap_dest_transfer_duration_mins: trapCombo.destination_transit_duration_mins ?? null,
      has_expensive_transfer: hasExpensiveTransfer,
      cheap_dest_iata:        trapCombo.out_dest_iata,
      cheap_origin_iata:      trapCombo.origin_iata,
      cheap_carrier_iata:     trapCombo.outbound_carrier,
      cheap_cabin_bag_cost:   trapCombo.cabin_bag_cost_gbp ?? 0,
      rec_description:        `${cn(recommended.outbound_carrier)} from ${recommended.origin_iata}`,
      rec_base_fare:          round(winnerBaseFare),
      rec_allin:              winnerAllin,
      allin_saving:           allinDiff,
    };
  })();

  console.log('[airport-debug] allInTrap:', JSON.stringify(allInTrap));

  // Derived: trap_alarming_reason — single pre-computed string for Card 1
  const trapAlarmingReason: string | null = (() => {
    if (!allInTrap) return null;
    const durMins = allInTrap.cheap_dest_transfer_duration_mins;
    const transferCost = allInTrap.cheap_dest_transfer;
    const transferAlarming = durMins != null && durMins > 60 && transferCost > 50;
    const bagsNotIncluded = allInTrap.cheap_cabin_bag_cost > 0;
    if (transferAlarming) {
      return `the ${allInTrap.cheap_dest_iata} transfer alone takes ${durMins} minutes and costs £${transferCost}`;
    }
    if (bagsNotIncluded) {
      return `cabin bags aren't included on ${cn(allInTrap.cheap_carrier_iata)} — add them and the cost jumps`;
    }
    return `bags and transfers add £${allInTrap.cheap_allin - allInTrap.cheap_fare} to the headline fare`;
  })();

  if (splitSaving) {
    moneyCards.push({
      lever: 'split_carrier',
      headline_hint: 'Mixing carriers saves money',
      voice: `Combining ${splitSaving.outCarrier} outbound and ${splitSaving.retCarrier} return saves £${splitSaving.saving} vs the cheapest single-airline option (${splitSaving.singleCarrier}). One sentence.`,
      facts: {
        saving:         splitSaving.saving,
        out_carrier:    splitSaving.outCarrier,
        ret_carrier:    splitSaving.retCarrier,
        single_carrier: splitSaving.singleCarrier,
      },
      verified_field: 'split_carrier',
      verified_value:  true,
      saving_gbp: splitSaving.saving,
    });
  }

  // ── CARD — allin_education (always present) ──────
  // Find the most striking fare vs all-in example
  // from same-date combinations
  const allExamples = combinationsForPrompt
    .filter(c =>
      c.outbound_date === recommended.outbound_date &&
      c.return_date   === recommended.return_date &&
      c.origin_iata   === recommended.origin_iata
    )
    .sort((a, b) =>
      (a.outbound_fare_gbp ?? 0) -
      (b.outbound_fare_gbp ?? 0)
    );

  const cheapestFareExample = allExamples[0];
  const mostExpensiveFareExample =
    allExamples[allExamples.length - 1];

  // Use allInTrap if exists, otherwise use
  // cheapest vs most expensive fare example
  const educationExample = allInTrap ??
    (cheapestFareExample && mostExpensiveFareExample &&
     cheapestFareExample !== mostExpensiveFareExample
      ? {
          cheap_description:
            `${cn(cheapestFareExample.outbound_carrier)} ` +
            `from ${cheapestFareExample.origin_iata}`,
          cheap_fare:  round(
            cheapestFareExample.outbound_fare_gbp ?? 0
          ),
          cheap_allin: round(
            cheapestFareExample.total_cost_gbp
          ),
          rec_description:
            `${cn(recommended.outbound_carrier)} ` +
            `from ${recommended.origin_iata}`,
          rec_base_fare: round(
            (recommended.outbound_fare_gbp ?? 0) +
            (recommended.return_fare_gbp ?? 0)
          ),
          rec_allin:   round(recommended.total_cost_gbp),
          allin_saving: round(
            cheapestFareExample.total_cost_gbp -
            recommended.total_cost_gbp
          ),
          has_expensive_transfer: false,
          cheap_dest_transfer: 0,
          cheap_dest_iata: cheapestFareExample.out_dest_iata,
        }
      : null
    );

  if (educationExample) {
    moneyCards.push({
      lever: 'allin_trap',
      headline_hint:
        'Google Flights shows fares — we show costs',
      voice: `HEADLINE MUST BE EXACTLY: "Google Flights shows fares — we show costs"

Use cheap_description and rec_description from facts VERBATIM.

Write exactly three sentences:
1. "[cheap_description]: fare £[cheap_fare] — but all-in (fare + bags + seats + transport to airport)${educationExample.has_expensive_transfer ? ` plus £${educationExample.cheap_dest_transfer} destination transfer` : ''} totals £[cheap_allin]."
2. "[rec_description]: all-in £[rec_allin] — £[allin_saving] less${educationExample.allin_saving > 0 ? ' despite the higher base fare' : ''}."
3. "That's what Google Flights won't show you."

If allin_saving <= 0, skip sentence 2 and instead write: "We show the true all-in cost so there are no surprises at checkout."`,
      facts: {
        locked_headline:
          'Google Flights shows fares — we show costs',
        cheap_description:
          educationExample.cheap_description,
        cheap_fare:
          educationExample.cheap_fare,
        cheap_allin:
          educationExample.cheap_allin,
        rec_description:
          educationExample.rec_description,
        rec_base_fare:
          educationExample.rec_base_fare,
        rec_allin:
          educationExample.rec_allin,
        allin_saving:
          educationExample.allin_saving,
        has_expensive_transfer:
          educationExample.has_expensive_transfer,
      },
      verified_field: 'total_cost_gbp',
      verified_value:  round(recommended.total_cost_gbp),
      saving_gbp: educationExample.allin_saving > 0
        ? educationExample.allin_saving
        : null,
    });
  }

  // Transport — outbound
  const outMode: 'uber' | 'transit' =
    context.transitPreference === 'uber' ? 'uber' : 'transit';
  const tCostOut    = recommended.outbound_transit_cost_gbp ?? 0;
  const tChangesOut = recommended.outbound_transit_changes ?? 0;
  const tMinsOut    = recommended.outbound_transit_duration_mins;
  const uLowOut     = recommended.outbound_uber_low_gbp;
  const uHighOut    = recommended.outbound_uber_high_gbp;
  const earlyOut    = recommended.outbound_early_warning ||
                      recommended.outbound_departure_quality === 'very_early';

  let transportCard: CardSpec | null = null;

  if (outMode === 'transit' && uLowOut != null && tMinsOut != null) {
    const saving = round(uLowOut - tCostOut);
    const uMinsOut = recommended.outbound_uber_duration_mins;
    const comparableTime = uMinsOut == null || tMinsOut <= uMinsOut + 15;
    if (saving >= 40 && tChangesOut <= 1 && comparableTime) {
      transportCard = {
        lever: 'transport_outbound',
        headline_hint: 'Transit beats Uber here',
        voice: `Defend transit to ${recommended.origin_iata}: saves £${saving} vs Uber, takes around ${round5(tMinsOut)} minutes, ${tChangesOut === 0 ? 'no changes' : '1 change'}, avoids surge pricing. One sentence.`,
        facts: {
          airport:          recommended.origin_iata,
          route:            recommended.outbound_transit_route,
          transit_cost:     round(tCostOut),
          saving_vs_uber:   saving,
          changes:          tChangesOut,
          time_around_mins: round5(tMinsOut),
          uber_low:         round5(round(uLowOut)),
          uber_high:        uHighOut ? round5(round(uHighOut)) : null,
        },
        verified_field: 'outbound_transit_cost_gbp',
        verified_value:  round(tCostOut),
        saving_gbp: saving,
      };
    }
  } else if (outMode === 'uber' && uLowOut != null && uHighOut != null) {
    if (earlyOut || tChangesOut >= 2) {
      transportCard = {
        lever: 'transport_outbound',
        headline_hint: 'Worth the Uber',
        voice: `Justify taking an Uber to ${recommended.origin_iata}: public transport means ${tChangesOut} change${tChangesOut === 1 ? '' : 's'} at ${recommended.outbound_departure_time ?? 'an early hour'} with kids, and Uber goes direct for £${round5(round(uLowOut))}–£${round5(round(uHighOut))}.${winnerIsCheapest ? ' The all-in is still the cheapest viable trip.' : ''} One sentence.`,
        facts: {
          airport:              recommended.origin_iata,
          uber_low:             round5(round(uLowOut)),
          uber_high:            round5(round(uHighOut)),
          transit_changes:      tChangesOut,
          departure_time:       recommended.outbound_departure_time,
          still_cheapest_allin: winnerIsCheapest,
        },
        verified_field: 'outbound_uber_high_gbp',
        verified_value:  round(uHighOut),
        saving_gbp: null,
      };
    }
  }

  // Transport — return (only fires if outbound transport card did NOT fire)
  if (!transportCard) {
    const retMode: 'uber' | 'transit' = outMode;
    const tCostRet    = recommended.return_transit_cost_gbp ?? 0;
    const tChangesRet = recommended.return_transit_changes ?? 0;
    const uLowRet     = recommended.return_uber_low_gbp;
    const uHighRet    = recommended.return_uber_high_gbp;
    const earlyRet    = recommended.return_departure_quality === 'very_early';

    if (retMode === 'transit' && uLowRet != null) {
      const saving = round(uLowRet - tCostRet);
      if (saving >= 40 && tChangesRet <= 1) {
        transportCard = {
          lever: 'transport_return',
          headline_hint: 'Transit home beats Uber',
          voice: `Getting home from ${recommended.ret_dest_iata ?? recommended.origin_iata}: transit costs £${round(tCostRet)} and saves £${saving} vs Uber. ${tChangesRet === 0 ? 'No changes.' : '1 change.'} One sentence.`,
          facts: {
            airport:        recommended.ret_dest_iata ?? recommended.origin_iata,
            route:          recommended.return_transit_route,
            transit_cost:   round(tCostRet),
            saving_vs_uber: saving,
            changes:        tChangesRet,
            uber_low:       round5(round(uLowRet)),
            uber_high:      uHighRet ? round5(round(uHighRet)) : null,
          },
          verified_field: 'return_transit_cost_gbp',
          verified_value:  round(tCostRet),
          saving_gbp: saving,
        };
      }
    } else if (retMode === 'uber' && uLowRet != null && uHighRet != null) {
      if (earlyRet || tChangesRet >= 2) {
        transportCard = {
          lever: 'transport_return',
          headline_hint: 'Worth the Uber home',
          voice: `The family is ARRIVING at ${recommended.ret_dest_iata ?? recommended.origin_iata} from Barcelona and needs to get HOME. Public transport home involves ${tChangesRet} change${tChangesRet === 1 ? '' : 's'} at ${recommended.return_arrival_time ?? 'an early hour'} with tired kids. Uber from ${recommended.ret_dest_iata ?? recommended.origin_iata} costs £${round5(round(uLowRet))}–£${round5(round(uHighRet ?? uLowRet))} direct to home. Write: "Getting home FROM [airport] ..." — never "to [airport]", never "to Stansted", never mixing up directions. One sentence.`,
          facts: {
            airport:         recommended.ret_dest_iata ?? recommended.origin_iata,
            arrival_time:    recommended.return_arrival_time,
            uber_low:        round5(round(uLowRet)),
            uber_high:       round5(round(uHighRet)),
            transit_changes: tChangesRet,
          },
          verified_field: 'return_uber_high_gbp',
          verified_value:  round(uHighRet),
          saving_gbp: null,
        };
      }
    }
  }

  if (transportCard) moneyCards.push(transportCard);

  // ── QUALITATIVE CARDS ─────────────────────────────────────────────────
  const qualitativeCards: CardSpec[] = [];

  // Early return heads-up
  // When baseline is recommended, use the derived return departure time from
  // fare_snapshots rather than the recommended combination's quality field.
  const earlyReturnFires = isBaselineCheapest
    ? (() => {
        const t = context.baseline_ret_dep_time;
        if (!t || t === 'unknown') return false;
        return parseInt(t.slice(0, 2)) < 9;
      })()
    : recommended.return_departure_quality === 'very_early';

  if (earlyReturnFires) {
    const retDep = isBaselineCheapest
      ? (context.baseline_ret_dep_time ?? '05:00')
      : (recommended.return_departure_time ?? '05:00');
    const tCostRet    = recommended.return_transit_cost_gbp ?? 0;
    const uLowRet     = recommended.return_uber_low_gbp;
    const uHighRet    = recommended.return_uber_high_gbp;
    qualitativeCards.push({
      lever: 'early_return_warning',
      headline_hint: 'Early return — plan ahead',
      voice: `Copy each statement from facts VERBATIM.
Write exactly two sentences — no more:

Sentence 1: "[bcn_departure]."
Sentence 2: "[arrival_statement]; [transit_statement]. [uber_statement] — worth considering with tired kids after a night flight."

Do not add, remove, or rephrase anything. Assembly only.`,
      facts: {
        bcn_departure:     `Flight leaves Barcelona at ${retDep} — plan to leave the hotel around 03:00–03:30`,
        arrival_statement: `Lands at ${recommended.ret_dest_iata ?? 'STN'} at ${recommended.return_arrival_time?.toString().slice(0,5) ?? '07:45'}`,
        transit_statement: `${simplifyRoute(recommended.return_transit_route)} (£${round(tCostRet)}) is already included in your cost`,
        uber_statement:    `Uber from ${recommended.ret_dest_iata ?? 'STN'} home costs £${uLowRet ? round5(round(uLowRet)) : 'X'}–£${uHighRet ? round5(round(uHighRet)) : 'Y'} direct`,
      },
      verified_field: 'return_departure_quality',
      verified_value:  'very_early',
      saving_gbp: null,
    });
  }

  // Transit changes heads-up
  if (
    outMode === 'transit' &&
    (recommended.outbound_transit_changes ?? 0) >= 2
  ) {
    const changes = recommended.outbound_transit_changes ?? 2;
    const route   = recommended.outbound_transit_route ?? 'to the airport';
    qualitativeCards.push({
      lever: 'transit_changes',
      headline_hint: 'Multi-change journey outbound',
      voice: `Practical heads-up for a family with kids and luggage: getting to ${recommended.origin_iata} involves ${changes} changes (${route}). Not a dealbreaker but worth knowing — allow extra time and consider whether an Uber is worth the premium on the day. One sentence. Warm, not alarming.`,
      facts: {
        airport:   recommended.origin_iata,
        changes:   changes,
        route:     route,
        uber_low:  recommended.outbound_uber_low_gbp ? round5(round(recommended.outbound_uber_low_gbp)) : null,
        uber_high: recommended.outbound_uber_high_gbp ? round5(round(recommended.outbound_uber_high_gbp)) : null,
      },
      verified_field: 'outbound_transit_changes',
      verified_value:  changes,
      saving_gbp: null,
    });
  }

  // Push money cards (cap 3); qualitative cards handled separately
  cards.push(...moneyCards.slice(0, 3));

  // ── SELECTION STORY CARD — pushed after splitSaving/allInTrap resolved ─
  // Only fires for genuine routing tension: all-in trap or open-jaw.
  // Split carrier saving is covered by the split_carrier card — never here.
  const hasSelectionStory =
    allInTrap !== null ||
    (recommended.out_dest_iata !== recommended.ret_dest_iata);

  if (hasSelectionStory) {
    const storyFacts: Record<string, string | number | boolean | null> = {
      locked_headline: 'Why this routing',
      out_carrier:     cn(recommended.outbound_carrier),
      ret_carrier:     cn(recommended.return_carrier),
      out_airport:     recommended.origin_iata,
      ret_airport:     recommended.ret_dest_iata,
      is_split:        recommended.split_carrier,
      is_open_jaw:     recommended.origin_iata !== recommended.ret_dest_iata,
    };
    if (splitSaving?.saving) storyFacts.split_saving = splitSaving.saving;
    if (allInTrap) {
      storyFacts.allin_tension        = true;
      storyFacts.cheaper_fare_airport = allInTrap.cheap_dest_iata;
    }

    cards.push({
      lever: 'selection_story',
      headline_hint: 'Why this routing',
      voice: `CRITICAL: Do NOT mention split carrier saving or the £[X] saving from mixing carriers. That is covered by the split_carrier card.

The selection_story explains ONLY the airport or destination routing tension:
- Why a secondary destination airport (like Reus) looks cheap on the fare but costs more all-in
- Why different outbound and return airports were chosen

If the only tension is split carrier (no all-in trap, no open jaw), do NOT fire this card — return null and skip it.

${allInTrap ? `The cheapest fare airport (${allInTrap.cheap_dest_iata}) looks cheaper on the fare but costs more all-in.` : ''}
${recommended.out_dest_iata !== recommended.ret_dest_iata ? `Different destination airports each way (${recommended.out_dest_iata} out, ${recommended.ret_dest_iata} in) because all-in costs diverge once transport is included.` : ''}

One sentence. Specific. No carrier saving numbers.`,
      facts: storyFacts,
      verified_field: 'outbound_carrier',
      verified_value:  recommended.outbound_carrier,
      saving_gbp: splitSaving?.saving ?? null,
    });
  }

  // ── Card filtering based on saving category ────────────────────────────
  let filteredCards = cards;

  if (isBaselineCheapest) {
    filteredCards = cards.filter(c =>
      !['value_tradeoff', 'allin_trap'].includes(c.lever)
    );
  }

  if (isFoundSaving) {
    const diff = round(recommended.total_inc_fine -
      (cheapestOverall?.total_inc_fine ?? recommended.total_inc_fine));
    if (diff < 15) {
      filteredCards = cards.filter(c => c.lever !== 'value_tradeoff');
    }
  }

  // Inset day leads, qualitative cards excluded from timeline
  const insetCard = filteredCards.find(c => c.lever === 'inset_day');
  const otherCards = filteredCards.filter(c => c.lever !== 'inset_day');
  const orderedCards = insetCard
    ? [insetCard, ...otherCards]
    : filteredCards;
  let finalCards = orderedCards.slice(0, 5);

  // ── Override card set when baseline is cheapest ───────────────────────────
  if (isBaselineCheapest) {
    const baselineCards: CardSpec[] = [];
    const blAllin  = context.baseline_allin ?? round(recommended.total_cost_gbp);
    const blFare   = context.baseline_fare  ?? 0;
    const blAirport = context.baseline_airport_name ?? 'Heathrow';
    const blCarrier = context.baseline_carrier ?? 'BA';
    const blOrigin  = context.baseline_origin_iata ?? 'LHR';
    const blOutArr  = context.baseline_out_arr_time ?? recommended.outbound_arrival_time?.toString().slice(0, 5) ?? '';
    const blRetDep  = context.baseline_ret_dep_time ?? recommended.return_departure_time?.toString().slice(0, 5) ?? '';
    const blRetArr  = context.baseline_ret_arr_time ?? recommended.return_arrival_time?.toString().slice(0, 5) ?? '';
    const blOutDep  = recommended.outbound_departure_time?.toString().slice(0, 5) ?? '';

    // Card 1 — Trap card (tiered by allin_saving)
    if (allInTrap) {
      const saving = allInTrap.allin_saving;
      const cheapCarrier = cn(allInTrap.cheap_description.split(' from ')[0] ?? '');
      const cheapOrigin  = allInTrap.cheap_origin_iata;
      const trapReason   = trapAlarmingReason ?? `bags and transfers add £${allInTrap.cheap_allin - allInTrap.cheap_fare} to the headline fare`;

      let trapHeadline: string;
      let trapVoice: string;
      if (saving >= 150) {
        trapHeadline = "The fare isn't the cost";
        trapVoice = `Write this card in four beats — do not reorder, do not add detail beyond what is given, do not truncate: Beat 1 (hook): '${cheapCarrier} from ${cheapOrigin} shows £${allInTrap.cheap_fare}.' Beat 2 (reveal): 'All-in it's £${allInTrap.cheap_allin}.' Beat 3 (reason): '${trapReason}.' Beat 4 (payoff): '${cn(blCarrier)} from ${blOrigin} at £${blAllin} is £${saving} less — despite the higher headline fare.' Write as flowing prose, not a list. Four sentences maximum.`;
      } else if (saving >= 50) {
        trapHeadline = "What the fare doesn't show";
        trapVoice = `Write this card in four beats — do not reorder, do not add detail beyond what is given: Beat 1 (hook): '${cheapCarrier} shows £${allInTrap.cheap_fare}.' Beat 2 (reveal): 'Once bags and transfers are counted, it's £${allInTrap.cheap_allin}.' Beat 3 (reason): '${trapReason}.' Beat 4 (payoff): '${cn(blCarrier)} at £${blAllin} is £${saving} less once everything's counted.' Write as flowing prose. Four sentences maximum.`;
      } else {
        trapHeadline = 'Every option priced all-in';
        trapVoice = `Write this card in three beats: Beat 1: 'The cheapest headline fare on this route is £${allInTrap.cheap_fare} with ${cheapCarrier}.' Beat 2: 'Once bags, transit, and transfers are included, it comes to £${allInTrap.cheap_allin}.' Beat 3: '${cn(blCarrier)} from ${blOrigin} at £${blAllin} came out best on total cost — not just fare.' Three sentences. Do not add anything else.`;
      }
      baselineCards.push({
        lever: 'allin_trap',
        headline_hint: trapHeadline,
        voice: trapVoice,
        facts: {
          locked_headline: trapHeadline,
          cheap_carrier: cheapCarrier,
          cheap_origin_iata: cheapOrigin,
          cheap_fare: allInTrap.cheap_fare,
          cheap_allin: allInTrap.cheap_allin,
          trap_alarming_reason: trapReason,
          baseline_carrier: cn(blCarrier),
          baseline_origin_iata: blOrigin,
          baseline_allin: blAllin,
          allin_saving: saving,
        },
        verified_field: 'total_cost_gbp',
        verified_value: blAllin,
        saving_gbp: saving,
      });
    } else {
      baselineCards.push({
        lever: 'allin_transparency',
        headline_hint: 'Every option priced all-in',
        voice: `Write this card in three beats: Beat 1: 'We checked ${combCount} combinations and priced each one with bags, airport transit, and destination transfer included.' Beat 2: 'We also scored every option on arrival time, departure hour, and transit changes — not just cost.' Beat 3: 'The ${cn(blCarrier)} round-trip from ${blAirport} — the closest airport to your school — holds up on both.' Three sentences. Do not add anything else.`,
        facts: {
          locked_headline: 'Every option priced all-in',
          combination_count: combCount,
          baseline_carrier: cn(blCarrier),
          baseline_airport: blAirport,
          baseline_allin: blAllin,
        },
        verified_field: 'total_cost_gbp',
        verified_value: blAllin,
        saving_gbp: null,
      });
    }

    // Card 2 — The schedule works
    baselineCards.push({
      lever: 'quality_validation',
      headline_hint: 'The schedule works',
      voice: `Three sentences, this order, no truncation: 1. 'Arrives ${destinationName} ${blOutArr} — you're at the hotel before lunch.' 2. 'Returns ${blRetDep} from ${destinationName}, landing ${blRetArr} — a full last day and a reasonable school-night arrival.' 3. 'The ${blOutDep} departure is an early start, but it keeps the cost down and gets you there first thing.' Write verbatim using these times. Do not paraphrase or reorder.`,
      facts: {
        locked_headline: 'The schedule works',
        sentence_1: `Arrives ${destinationName} ${blOutArr} — you're at the hotel before lunch.`,
        sentence_2: `Returns ${blRetDep} from ${destinationName}, landing ${blRetArr} — a full last day and a reasonable school-night arrival.`,
        sentence_3: `The ${blOutDep} departure is an early start, but it keeps the cost down and gets you there first thing.`,
      },
      verified_field: 'outbound_arrival_time',
      verified_value: blOutArr,
      saving_gbp: null,
    });

    // Card 3 — Inset day option (from scored pool, not shortlist)
    const insetFromPool = context.bestInsetFromPool;
    if (insetFromPool) {
      const insetRetTime = insetFromPool.return_departure_time?.slice(0, 5) ?? '';
      const insetDelta = round(insetFromPool.total_cost_gbp - blAllin);
      const insetDeltaLabel = `£${Math.abs(insetDelta)} ${insetDelta >= 0 ? 'more' : 'less'}`;
      const insetOutDep = insetFromPool.outbound_departure_time?.slice(0, 5) ?? '';
      const insetDateFormatted = (() => {
        const d = new Date(insetFromPool.outbound_date + 'T00:00:00');
        const dayName = d.toLocaleDateString('en-GB', { weekday: 'long' });
        const day = d.getDate();
        const month = d.toLocaleDateString('en-GB', { month: 'short' });
        return `${dayName} ${day} ${month}`;
      })();
      // Checkout window: dep - 2h30m (floor) to dep - 2h00m (ceiling), rounded to 5 min
      let checkoutFrom = '';
      let checkoutTo = '';
      if (insetRetTime) {
        const [rh, rm] = insetRetTime.split(':').map(Number);
        const totalMins = rh * 60 + rm;
        const fmt5 = (m: number) => {
          const wrapped = ((m % 1440) + 1440) % 1440;
          return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
        };
        checkoutFrom = fmt5(Math.round((totalMins - 150) / 5) * 5);
        checkoutTo   = fmt5(Math.round((totalMins - 120) / 5) * 5);
      }
      const insetTotal = round(insetFromPool.total_cost_gbp);
      baselineCards.push({
        lever: 'inset_day_option',
        headline_hint: 'Inset day option',
        voice: `Five elements, this order, no truncation: 1. 'Flying ${insetOutDep} on ${insetDateFormatted} (the inset day) costs £${insetTotal} all-in — ${insetDeltaLabel} than Saturday.' 2. 'The return departs ${destinationName} at ${insetRetTime},' 3. 'which means a ${checkoutFrom}–${checkoutTo} hotel checkout.' 4. 'We're not recommending it,' 5. 'but it's there if you want it.' Write as two or three sentences. Elements 4 and 5 must appear verbatim as the closing sentence.`,
        facts: {
          locked_headline: 'Inset day option',
          inset_out_dep_time: insetOutDep,
          inset_date_formatted: insetDateFormatted,
          inset_total: insetTotal,
          inset_delta: insetDeltaLabel,
          inset_ret_dep_time: insetRetTime,
          inset_checkout_from: checkoutFrom,
          inset_checkout_to: checkoutTo,
          sentence_1: `Flying ${insetOutDep} on ${insetDateFormatted} (the inset day) costs £${insetTotal} all-in — ${insetDeltaLabel} than Saturday.`,
          sentence_2: `The return departs ${destinationName} at ${insetRetTime}, which means a ${checkoutFrom}–${checkoutTo} hotel checkout. We're not recommending it, but it's there if you want it.`,
        },
        verified_field: 'total_cost_gbp',
        verified_value: insetTotal,
        saving_gbp: null,
      });
    }

    // Card 4 — Cabin bags included (when baseline carrier includes bags and LCCs charge)
    const lccMin = context.lcc_cabin_bag_min_fee;
    const lccMax = context.lcc_cabin_bag_max_fee;
    const sessionBags = context.cabinBags ?? 2;
    const bagWord = sessionBags === 1 ? 'bag' : 'bags';
    if ((recommended.cabin_bag_cost_gbp ?? 0) === 0 && lccMin && lccMax && lccMin > 0) {
      const minTotal = round(lccMin * sessionBags * 2);
      const maxTotal = round(lccMax * sessionBags * 2);
      baselineCards.push({
        lever: 'cabin_bags_included',
        headline_hint: 'Cabin bags included',
        voice: `Exactly two sentences — no more: 1. '${cn(blCarrier)} includes ${sessionBags} cabin ${bagWord} in the fare — no extra charge.' 2. 'Budget carriers on this route charge £${lccMin}–£${lccMax} per bag per flight — for ${sessionBags} ${bagWord} across both legs, that's £${minTotal}–£${maxTotal} extra not shown in their fare.' Stop after the second sentence. Do not add caveats or disclaimers.`,
        facts: {
          locked_headline: 'Cabin bags included',
          sentence_1: `${cn(blCarrier)} includes ${sessionBags} cabin ${bagWord} in the fare — no extra charge.`,
          sentence_2: `Budget carriers on this route charge £${lccMin}–£${lccMax} per bag per flight — for ${sessionBags} ${bagWord} across both legs, that's £${minTotal}–£${maxTotal} extra not shown in their fare.`,
        },
        verified_field: 'cabin_bag_cost_gbp',
        verified_value: 0,
        saving_gbp: minTotal,
      });
    }

    finalCards = baselineCards;
  }

  // ── Override card set for significant / found_saving ───────────────────
  // The problem statement, headline, and subheadline already carry the
  // saving breakdown. Order: (1) why this beats the alternatives on
  // quality, (2) the penalty notice — a single merged card covering both
  // the fine itself and the fine-avoiding alternative (only when the
  // winner has absence days; see its comment above for why these two used
  // to be separate cards and no longer are), (3) the trade-off — early
  // return, early outbound, or split booking, whichever applies — with its
  // heading now naming the specific trigger instead of a generic "the one
  // trade-off that matters most" (see its comment above), (4) the cheaper
  // inset-day alternative (when one exists, is strictly cheaper than the
  // winner, and isn't the winner itself). Cards 2, 3, and 4 are each
  // independently conditional and can all be absent — card 2 only when
  // absence_days > 0, card 3 only when one of the three trigger conditions
  // actually applies (no card at all otherwise — see its comment above for
  // why a card is no longer forced), card 4 only when a cheaper inset-day
  // option exists. With none of them firing, order is just quality alone.
  // Replaces the old split_carrier / transport / selection_story narration
  // cards entirely.
  if (!isBaselineCheapest) {
    const nonBaselineCards: CardSpec[] = [];

    const blAllinForCards    = context.baseline_allin ?? round(recommended.total_cost_gbp);
    const winnerTotalRounded = round(recommended.total_cost_gbp);
    const savingForCards     = blAllinForCards - winnerTotalRounded;

    // Card 1 — Why this over the alternatives. Must answer "why did the
    // system pick THIS one" concretely (actual times/airports, never a
    // description of the scoring process in the abstract) AND state
    // explicitly which of three things won it: cheapest for these dates,
    // the inset-day option, or — when neither — the specific quality axis
    // (departure vs baseline, arrival vs the next-best alternative, or
    // return vs the next-best alternative). Checked in that priority
    // order: a combination that's both cheapest and quality-distinct
    // leads with "cheapest" as the simpler, more important fact.
    {
      const advantage = context.winner_quality_advantage;
      const originCity = an(recommended.origin_iata);
      const baselineOriginIata = context.baseline_origin_iata ?? 'LHR';
      const humanize = (q: string) => q.replace(/_/g, ' ');
      const winnerRetArrTime = recommended.return_arrival_time?.toString().slice(0, 5) ?? '';

      let sentence1: string;
      let sentence2: string;
      let sentence3: string;

      if (winnerIsCheapest) {
        sentence1 = `This is the cheapest option we found for these dates — ${context.winner_out_dep_time} from ${originCity}, arriving ${destinationName} at ${context.winner_arr_time}.`;
        sentence2 = `The return departs ${destinationName} at ${context.winner_ret_dep_time}, landing home at ${winnerRetArrTime}.`;
        sentence3 = `No other combination beat it on total all-in cost.`;
      } else if (recommended.is_inset_day) {
        sentence1 = `This uses ${context.schoolName ?? 'your school'}'s inset day — flying ${context.winner_out_dep_time} from ${originCity} with zero school absence.`;
        sentence2 = `You arrive ${destinationName} at ${context.winner_arr_time}, and the return lands home at ${winnerRetArrTime}${insetAddsNight ? ' — an extra night versus the best non-inset option' : ''}.`;
        sentence3 = `It isn't the cheapest combination available, but it wins on avoiding the fine risk entirely.`;
      } else if (advantage === 'departure_vs_baseline') {
        const [arrH, arrM] = context.winner_arr_time.split(':').map(Number);
        const arrHourDecimal = (arrH ?? 0) + (arrM ?? 0) / 60;
        const afternoonLabel = arrHourDecimal < 14.5 ? 'mid-afternoon' : 'late afternoon';
        sentence1 = `The ${context.winner_out_dep_time} departure from ${originCity} is the best timing we found for this window — no pre-dawn airport run.`;
        sentence2 = `The Saturday ${baselineOriginIata} option departs at ${context.baseline_out_dep_time ?? 'unknown'} — a ${humanize(context.baseline_out_dep_quality ?? '')} start that means a very early taxi with the family.`;
        sentence3 = `At ${context.winner_arr_time} you're in ${destinationName} by ${afternoonLabel} with the whole day ahead — it won on departure timing, not on being the cheapest option.`;
      } else if (advantage === 'arrival_vs_alternative') {
        sentence1 = `This combination arrives ${destinationName} at ${context.winner_arr_time} — you're checked in and out for the afternoon.`;
        sentence2 = `The next cheapest option arrives at ${context.alt_arr_time ?? 'much later'} — you lose most of your first day.`;
        sentence3 = `The ${context.winner_out_dep_time} departure is the trade-off, but it won on arrival quality, not on being the cheapest option.`;
      } else if (advantage === 'return_vs_alternative') {
        sentence1 = `The return departs ${destinationName} at ${context.winner_ret_dep_time} — your last day stays intact.`;
        sentence2 = `Cheaper alternatives return at ${context.alt_ret_dep_time ?? 'much earlier'} — a very early start that cuts your final day short.`;
        sentence3 = `It won on keeping the return civilised, not on being the cheapest option.`;
      } else {
        sentence1 = `The ${context.winner_out_dep_time} departure from ${originCity} arrives ${destinationName} at ${context.winner_arr_time} — no leg on this combination scored poorly on timing.`;
        sentence2 = `The return departs ${destinationName} at ${context.winner_ret_dep_time}, landing home at ${winnerRetArrTime}.`;
        sentence3 = `It won on the balance of cost and quality together — not the single cheapest option, and not the inset-day option, but nothing else scored better overall.`;
      }

      nonBaselineCards.push({
        lever: 'quality_advantage',
        headline_hint: 'Why this over the alternatives',
        voice: `Copy sentence_1, sentence_2, and sentence_3 from facts VERBATIM, in this order. Do not list all quality scores — the card is already built around the single most meaningful contrast. Three sentences only.`,
        facts: {
          locked_headline: 'Why this over the alternatives',
          sentence_1: sentence1,
          sentence_2: sentence2,
          sentence_3: sentence3,
        },
        verified_field: 'arrival_quality',
        verified_value: recommended.arrival_quality ?? '',
        saving_gbp: null,
      });
    }

    // Card 2 — Penalty notice + fine-avoiding alternative, merged into one
    // card (replaces the deleted sidebar absence notice; only fires when the
    // winner actually requires absence).
    //
    // These used to be two separate cards that each picked a different cost
    // basis to compare against — the fine-inclusive winner total in one,
    // the fine-exclusive winner total in the other — which silently made
    // the recommendation look better in both comparisons at once and never
    // surfaced the fact that the two bases actually disagree on which
    // option is cheaper. Whenever a fine-free alternative exists, state
    // BOTH comparisons (vs the no-fine winner total, vs the fine-inclusive
    // winner total) explicitly side by side, rather than picking one. This
    // is the standard pattern for any future absence-day trade-off — do
    // not go back to a single silently-chosen basis.
    if (absenceDays > 0) {
      const outboundDateFormatted = fmtDLong(recommended.outbound_date);
      const returnDateFormatted   = fmtDLong(recommended.return_date);
      const absenceOutDays = context.absence_out_days ?? 0;
      const absenceRetDays = context.absence_ret_days ?? 0;
      const outWord = absenceOutDays === 1 ? 'day' : 'days';
      const retWord = absenceRetDays === 1 ? 'day' : 'days';

      // Absence can fall on the outbound side (departs before the window
      // opens), the return side (lands after it closes), or both — never
      // attribute return-side absence to the departure date or vice versa.
      const outboundClause = `The outbound departs ${outboundDateFormatted} — ${absenceOutDays} school ${outWord} before the holiday begins`;
      const returnClause   = `The return lands ${returnDateFormatted} — ${absenceRetDays} school ${retWord} after term resumes on ${context.term_resume_date || 'the resume date'}`;
      const absenceSentence1 = absenceOutDays > 0 && absenceRetDays > 0
        ? `${outboundClause}, and ${returnClause.charAt(0).toLowerCase()}${returnClause.slice(1)}.`
        : absenceOutDays > 0
        ? `${outboundClause}.`
        : `${returnClause}.`;

      const dayWord = absenceDays === 1 ? 'day' : 'days';
      const headline = `This trip misses ${absenceDays} school ${dayWord} — £${fineGbp} if your school fines you`;
      const disclaimer = `We're not recommending unauthorised absence — you should know the numbers before you book.`;

      // The fine's arithmetic, shown explicitly wherever fine_gbp appears —
      // matches calculate_absence_fine.sql: £80 per parent per child per
      // "period" (one continuous stretch of missed school on the departure
      // side, the return side, or both — max 2). Deliberately NOT adding
      // any escalation-for-repeat-notices language — that needs a
      // confirmed source on how councils actually handle repeat offences,
      // which hasn't been verified. Flagged as a follow-up, not implemented.
      const finePeriods = (absenceOutDays > 0 ? 1 : 0) + (absenceRetDays > 0 ? 1 : 0);
      const periodsClause = finePeriods > 1 ? ` × ${finePeriods} periods (departure and return)` : '';
      const fineArithmetic = `That's £80 per parent per child per period — ${context.adults} adults × ${context.children} children${periodsClause}.`;

      // bestNoFineAlternative (assembleRecommendation.ts) is only offered
      // here when it is genuinely fine-free (filtered on absence_days === 0
      // whenever the winner itself has absence days) — safe to treat its
      // presence as "a fine-free option exists in the pool."
      if (context.alt_total_cost != null) {
        const altTotalCost = context.alt_total_cost;
        const altDeltaVsNoFineWinner = altTotalCost - winnerTotalRounded;
        const altDeltaVsFineInclusiveWinner = altTotalCost - netCostWithFine;

        const comparisonSentence = `The fine-free option costs £${altTotalCost} — ${context.alt_outbound_date_formatted} to ${context.alt_return_date_formatted}, no school days missed. That's £${Math.abs(altDeltaVsNoFineWinner)} ${altDeltaVsNoFineWinner >= 0 ? 'more' : 'less'} than the £${winnerTotalRounded} recommendation if no fine is issued, and £${Math.abs(altDeltaVsFineInclusiveWinner)} ${altDeltaVsFineInclusiveWinner >= 0 ? 'more' : 'less'} than the £${netCostWithFine} total if a fine is issued. Which comparison is right depends on your school.`;

        nonBaselineCards.push({
          lever: 'penalty_notice',
          headline_hint: headline,
          voice: `Copy sentence_1, sentence_2, sentence_3, and sentence_4 from facts VERBATIM, in this order. Four sentences exactly.`,
          facts: {
            locked_headline: headline,
            sentence_1: absenceSentence1,
            sentence_2: fineArithmetic,
            sentence_3: comparisonSentence,
            sentence_4: disclaimer,
          },
          verified_field: 'fine_gbp',
          verified_value: fineGbp,
          saving_gbp: null,
        });
      } else {
        const sentence3 = fineWipesSaving
          ? `With the fine, net cost is £${netCostWithFine} — £${netDeltaWithFine} more than ${BASELINE_NAME}.`
          : `Your net saving after the fine drops to £${savingForCards - fineGbp}.`;

        nonBaselineCards.push({
          lever: 'penalty_notice',
          headline_hint: headline,
          voice: `Copy sentence_1, sentence_2, sentence_3, and sentence_4 from facts VERBATIM, in this order. Four sentences exactly.`,
          facts: {
            locked_headline: headline,
            sentence_1: absenceSentence1,
            sentence_2: fineArithmetic,
            sentence_3: sentence3,
            sentence_4: disclaimer,
          },
          verified_field: 'fine_gbp',
          verified_value: fineGbp,
          saving_gbp: fineWipesSaving ? null : savingForCards - fineGbp,
        });
      }
    }

    // Card 3 — The trade-off, when there genuinely is one. Headings now
    // name the specific trigger (early_return/early_outbound/split_booking)
    // instead of a generic "the one trade-off that matters most" — that
    // let the heading answer "why does this card exist" on its own, so the
    // body doesn't need to restate the trigger either.
    //
    // No card at all when none of the three apply — the old fallback
    // ("timing_summary") rendered a card even when there was nothing
    // noteworthy to flag, just restating ordinary arrival/return times.
    // Confirmed safe to drop entirely: nonBaselineCards is already a
    // variable-length array (card 2/penalty_notice and card 4/inset are
    // both already conditional), and nothing downstream — lever_insights,
    // the price_movement splice, or the client's timelineCards.map — assumes
    // a fixed card count.
    {
      type TradeoffType = 'early_return' | 'early_outbound' | 'split_booking' | null;
      const tradeoffType: TradeoffType =
        recommended.return_departure_quality === 'very_early' ? 'early_return' :
        recommended.outbound_departure_quality === 'very_early' ? 'early_outbound' :
        recommended.outbound_carrier !== recommended.return_carrier ? 'split_booking' :
        null;

      const outDepTime = recommended.outbound_departure_time?.toString().slice(0, 5) ?? '';
      const outArrTime = recommended.outbound_arrival_time?.toString().slice(0, 5) ?? '';
      const retDepTime = recommended.return_departure_time?.toString().slice(0, 5) ?? '';

      if (tradeoffType === 'early_return') {
        const checkout = checkoutWindowFor(retDepTime);
        const returnArrivalAirport = recommended.ret_dest_iata ?? recommended.origin_iata;
        const transitHomeSentence = recommended.return_transit_mode === 'uber'
          ? `An Uber home from ${returnArrivalAirport} costs £${recommended.return_uber_low_gbp != null ? round5(round(recommended.return_uber_low_gbp)) : 'X'}–£${recommended.return_uber_high_gbp != null ? round5(round(recommended.return_uber_high_gbp)) : 'Y'} — worth considering with tired kids after an early flight.`
          : `The ${simplifyRoute(recommended.return_transit_route)} home is already included in your cost.`;
        nonBaselineCards.push({
          lever: 'early_return',
          headline_hint: 'Early return — plan around it',
          voice: `Copy sentence_1, sentence_2, sentence_3, and sentence_4 from facts VERBATIM, in this order. Use these exact times and costs. Do not mention other trade-offs.`,
          facts: {
            locked_headline: 'Early return — plan around it',
            sentence_1: `The return departs ${destinationName} at ${retDepTime} — plan to leave the hotel around ${checkout.from}–${checkout.to}.`,
            sentence_2: `You land at ${recommended.return_arrival_time?.toString().slice(0, 5) ?? ''}.`,
            sentence_3: transitHomeSentence,
            sentence_4: `If that's too early, the date matrix below shows alternatives.`,
          },
          verified_field: 'return_departure_time',
          verified_value: retDepTime,
          saving_gbp: null,
        });
      } else if (tradeoffType === 'early_outbound') {
        nonBaselineCards.push({
          lever: 'early_outbound',
          headline_hint: 'Early departure',
          voice: `Copy sentence_1 and sentence_2 from facts VERBATIM, in this order. Do not mention other trade-offs.`,
          facts: {
            locked_headline: 'Early departure',
            sentence_1: `The outbound departs ${recommended.origin_iata} at ${outDepTime} — you arrive ${destinationName} ${outArrTime}.`,
            sentence_2: `The early start is the trade-off that keeps the cost down and gets you there first thing.`,
          },
          verified_field: 'outbound_departure_time',
          verified_value: outDepTime,
          saving_gbp: null,
        });
      } else if (tradeoffType === 'split_booking') {
        nonBaselineCards.push({
          lever: 'split_booking',
          headline_hint: 'Two separate bookings',
          voice: `Copy sentence_1 and sentence_2 from facts VERBATIM, in this order. Do not mention other trade-offs.`,
          facts: {
            locked_headline: 'Two separate bookings',
            sentence_1: `This is two separate bookings — ${cn(recommended.outbound_carrier)} outbound and ${cn(recommended.return_carrier)} return. Book each directly.`,
            sentence_2: `If one flight changes, the other ticket is unaffected — check each carrier's change policy before booking.`,
          },
          verified_field: 'split_carrier',
          verified_value: recommended.split_carrier,
          saving_gbp: null,
        });
      }
      // else: nothing noteworthy about the timing — no card.
    }

    // Card 4 — The cheaper inset-day option (only when it exists, is
    // strictly cheaper than the winner — see showInsetCard's
    // `insetFromPool.total_cost_gbp < recommended.total_cost_gbp` check
    // above — and isn't the winner itself). "Cheaper" in the heading is
    // factually safe here specifically, unlike quality_advantage: this
    // card only ever fires when the strict-inequality check passed.
    if (showInsetCard && insetFromPool) {
      const insetRetDepTime = insetFromPool.return_departure_time?.slice(0, 5) ?? '';
      const insetDateFormatted = fmtDLong(insetFromPool.outbound_date);
      const insetTotal = round(insetFromPool.total_cost_gbp);
      const insetDelta = round(recommended.total_cost_gbp - insetFromPool.total_cost_gbp);
      const checkout = checkoutWindowFor(insetRetDepTime);

      nonBaselineCards.push({
        lever: 'inset_day_option',
        headline_hint: 'The cheaper inset-day option',
        voice: `Copy sentence_1, sentence_2, and sentence_3 from facts VERBATIM, in this order. All three required — close with sentence_3 exactly as given.`,
        facts: {
          locked_headline: 'The cheaper inset-day option',
          sentence_1: `Flying on ${insetDateFormatted} (the inset day) costs £${insetTotal} all-in — £${insetDelta} less than this recommendation.`,
          sentence_2: `The return departs ${destinationName} at ${insetRetDepTime}, which means a ${checkout.from}–${checkout.to} hotel checkout.`,
          sentence_3: `We're not recommending it, but it's there if you want it.`,
        },
        verified_field: 'total_cost_gbp',
        verified_value: insetTotal,
        saving_gbp: null,
      });
    }

    finalCards = nonBaselineCards;
  }

  console.log('[airport-debug] finalCards levers:',
    finalCards.map(c => c.lever));

  // Qualitative cards go to right column only
  const rightColumnCards = qualitativeCards.map(spec => {
    const f = spec.facts;
    let insight = '';
    if (spec.lever === 'early_return_warning') {
      insight = `${f.bcn_departure}. ${f.arrival_statement}; ${f.transit_statement}. ${f.uber_statement} — worth considering with tired kids after a night flight.`;
    } else if (spec.lever === 'transit_changes') {
      insight = `Getting to ${f.airport} involves ${f.changes} changes (${f.route}). Allow extra time — or consider Uber on the day.`;
    }
    return {
      lever:           spec.lever,
      headline:        spec.headline_hint,
      insight,
      verified_field:  spec.verified_field,
      verified_value:  spec.verified_value,
      saving_gbp:      spec.saving_gbp,
    };
  });

  const baselineDepartureLabel = (() => {
    const d = context.baseline_outbound_date;
    if (!d) return '';
    const date = new Date(d + 'T00:00:00');
    const day = date.getDate();
    const month = date.toLocaleDateString('en-GB', { month: 'short' });
    return `Saturday ${day} ${month}`;
  })();

  // ── Problem statement for significant/found_saving — pre-resolved in TS ──
  // Fixed four-sentence template: reference point → true cost → methodology
  // → finding. No fine mention — that lives in the penalty notice card.
  const blOriginForPS    = context.baseline_origin_iata ?? 'LHR';
  const BASELINE_CITY_NAMES: Record<string, string> = {
    LHR: 'Heathrow', LGW: 'Gatwick', LTN: 'Luton', STN: 'Stansted', LCY: 'City airport',
  };
  const baselineOriginCity = BASELINE_CITY_NAMES[blOriginForPS] ?? blOriginForPS;
  const baselineDateShort = baselineDepartureLabel.replace(/^\w+\s+/, '');

  // "all-in" is defined once, directly under the subheadline — say the
  // bare word here, don't restate what it includes.
  //
  // Deliberately no "on {date}" timestamp and no "distinct date pairs"
  // reconciliation clause in this sentence — both were tried and pulled
  // back out. The timestamp read as a search constraint ("priced ON this
  // date") rather than metadata, and belongs on the "Fares observed
  // {date}" stamp near the booking total / the modal footnote instead
  // (both already carry it, sourced from the same price_points series —
  // see distinctDatePairs/FamilyContext for the reconciliation fact
  // itself, still available for use elsewhere, just not here). The
  // reconciliation clause turned the sentence's ending into a flat
  // logistics statement ("N distinct date pairs shown below") instead of
  // a conclusion — this is the opening hook of the whole page, not a
  // methods section, and needs to land on "You can," not trail off.
  const otherwiseProblemStatement = `Write the problem statement as EXACTLY this sentence, no changes:
"The obvious way to book ${context.borough ?? 'London'}'s half-term is the first Saturday — ${baselineDateShort || baselineDepartureLabel || 'the first Saturday'} from ${baselineOriginCity}. That comes to £${context.baseline_allin ?? 'unknown'} all-in. We priced ${combCount} combinations across five London airports and every viable date pair to see if you could do better. You can."`;

  // ── Subheadline for significant/found_saving — pre-resolved in TS ────────
  // When the winner's outbound and return use different London airports
  // (an open jaw), state both explicitly — this is a materially important
  // fact for the family (rules out driving/parking, changes the return
  // journey, and is the reason return transit costs diverge from baseline).
  const subheadlineAirportsDiffer = recommended.origin_iata !== recommended.ret_dest_iata;
  // "all-in" is defined once, directly under the subheadline (see
  // ALL_IN_DEFINITION in copyConstants.ts) — say the bare word here, don't
  // restate what it includes.
  const otherwiseSubheadline = subheadlineAirportsDiffer
    ? `Write the subheadline as EXACTLY this sentence, no changes:
"Out from ${an(recommended.origin_iata)} with ${cn(recommended.outbound_carrier)} on ${fmtDLong(recommended.outbound_date)}, back into ${an(recommended.ret_dest_iata)} with ${cn(recommended.return_carrier)} on ${fmtDLong(recommended.return_date)} — two separate bookings, all-in."`
    : `Write the subheadline as EXACTLY this sentence, no changes:
"Flying ${cn(recommended.outbound_carrier)} from ${an(recommended.origin_iata)} on ${fmtDLong(recommended.outbound_date)}, returning ${cn(recommended.return_carrier)} on ${fmtDLong(recommended.return_date)} — all-in."`;

  const insightPrompt = `You are writing copy for a financial intelligence tool helping London families save money on school holiday flights. Your only job is to write headlines and insight sentences for pre-decided cards. You do not choose which cards exist. You do not calculate anything.

FAMILY:
- School: ${context.schoolName ?? 'unknown'}, ${context.borough ?? 'London'}
- Party: ${context.adults} adults, ${context.children} children
- Destination: ${destinationName}
- Window: ${context.windowStart} to ${context.windowEnd}

RECOMMENDED COMBINATION:
${JSON.stringify({
  outbound_date:           recommended.outbound_date,
  return_date:             recommended.return_date,
  outbound_carrier:        recommended.outbound_carrier,
  return_carrier:          recommended.return_carrier,
  origin_iata:             recommended.origin_iata,
  out_dest_iata:           recommended.out_dest_iata,
  trip_nights:             recommended.trip_nights,
  is_inset_day:            recommended.is_inset_day,
  outbound_departure_time: recommended.outbound_departure_time,
  outbound_arrival_time:   recommended.outbound_arrival_time,
  return_departure_time:   recommended.return_departure_time,
  return_arrival_time:     recommended.return_arrival_time,
  total_cost_gbp:          round(recommended.total_cost_gbp),
  total_inc_fine:          round(recommended.total_inc_fine),
}, null, 2)}

BENCHMARK:
- Typical Saturday booking: ${context.benchmarkCost != null ? `£${round(context.benchmarkCost)}` : 'not available'}
- Saving vs benchmark: ${context.benchmarkCost != null ? `£${round(context.benchmarkCost - recommended.total_cost_gbp)}` : 'not available'}

SELECTION CONTEXT:
- recommended_nights: ${recommended.trip_nights}
- cheapest_nights: ${cheapestOverall?.trip_nights ?? recommended.trip_nights}
- nights_diff: ${recommended.trip_nights - (cheapestOverall?.trip_nights ?? recommended.trip_nights)}
- baseline_nights: ${cheapestOverall?.trip_nights ?? recommended.trip_nights}
- cheapest_diff: ${cheapestDiff}
- baseline_cost: £${context.benchmarkCost != null ? round(context.benchmarkCost) : 'unknown'}
- baseline_diff: ${baselineDiff != null
    ? (baselineDiff > 0
       ? `£${baselineDiff} more than baseline`
       : `£${Math.abs(baselineDiff)} less than baseline`)
    : 'unknown'}
- destination_name: ${destinationName}
- is_baseline_cheapest: ${isBaselineCheapest}
- baseline_total: £${context.benchmarkCost ?? 'unknown'}
- baseline_carrier: British Airways round-trip
- baseline_dates: ${context.trueCheapest_outbound ?? ''} to ${context.trueCheapest_return ?? ''}
- cheapest_two_leg_total: £${context.trueCheapest_total_cost ?? 'unknown'}
- cheapest_vs_baseline_diff: £${context.trueCheapest_total_cost && context.benchmarkCost
    ? Math.round(context.trueCheapest_total_cost - context.benchmarkCost)
    : 'unknown'} more than baseline
- baseline_fare: £${context.baseline_fare ?? 'unknown'} (what Google Flights shows for the BA round-trip)
- baseline_allin: £${context.baseline_allin ?? 'unknown'} (fare + bags + airport transport)
- baseline_dep_quality: ${context.baseline_out_dep_quality ?? 'unknown'} (e.g. very_early = 06:10 departure)
- baseline_origin_iata: ${context.baseline_origin_iata ?? 'LHR'}
- baseline_departure_label: ${baselineDepartureLabel || 'unknown'} (e.g. "Saturday 25 Oct")
- saving_category: ${context.savingCategory}
- saving_vs_baseline: £${context.baseline_allin != null ? Math.abs(round(context.baseline_allin - recommended.total_cost_gbp)) : 'unknown'}
- winner_airport: ${an(recommended.origin_iata)}
- winner_carrier: ${cn(recommended.outbound_carrier)}
- absence_days: ${absenceDays}
- fine_gbp: £${fineGbp}
- fine_wipes_saving: ${fineWipesSaving}
- net_cost_with_fine: £${netCostWithFine}
- net_delta_with_fine: £${netDeltaWithFine}
- winner_is_inset_option: ${winnerIsInsetOption}

──────────────────────────────────────────
HEADLINE
──────────────────────────────────────────
IF is_baseline_cheapest is true, write instead:
  "${context.baseline_trip_nights ?? recommended.trip_nights} nights in ${destinationName} with ${cn(context.baseline_carrier ?? 'BA')} from ${context.baseline_airport_name ?? 'Heathrow'}, the closest airport to your school — £${context.baseline_allin ?? round(recommended.total_cost_gbp)} all-in."
  Do not use "We found", "beat", "typical", or comparison language. Lead with the trip.

OTHERWISE, HEADLINE varies by saving_category:

IF saving_category = 'significant':
  "We found ${recommended.trip_nights} nights in ${destinationName} — £${round(recommended.total_cost_gbp)} all-in — £${context.baseline_allin != null ? round(context.baseline_allin - recommended.total_cost_gbp) : '[saving]'} less than ${BASELINE_NAME} from ${context.baseline_airport_name ?? 'Heathrow'}."

IF saving_category = 'found_saving':
  "We found a stronger option for ${destinationName} this half-term — £${round(recommended.total_cost_gbp)} all-in, £${context.baseline_allin != null ? round(context.baseline_allin - recommended.total_cost_gbp) : '[saving]'} less than ${BASELINE_NAME}."

RULES:
- Always call the comparison baseline "${BASELINE_NAME}" (optionally followed by "from {airport}") — never "typical booking," "standard booking," "the obvious option," or any other phrasing. This exact name is used verbatim everywhere else the baseline is mentioned on the page (booking box, penalty card, comparison table) — do not vary it here.
- Never say "we found savings." Say "we found a better-value option" or "a stronger option."
- Never say "cheapest option" in the headline
- Never use decimal places
- Always lead with nights or saving, not departure mechanic

SUBHEADLINE
IF is_baseline_cheapest is true:
  "Direct flight both ways, arriving ${destinationName} at ${context.baseline_out_arr_time ?? ''} and home by ${context.baseline_ret_arr_time ?? ''} — early start, and you gain the whole day."
  Do not repeat the cost. No comparison language.

OTHERWISE (saving_category = 'significant' or 'found_saving'):
${otherwiseSubheadline}

Do not repeat the cost. One sentence max.

PROBLEM STATEMENT
The problem statement always leads with the Google Flights fare vs all-in reality — regardless of whether our pick wins or the baseline wins.

Use these values from SELECTION CONTEXT:
- baseline_fare = what Google Flights shows for the BA round-trip
- baseline_allin = what it actually costs (fare + bags + transport)

IF is_baseline_cheapest is true:
"Google Flights shows £${context.baseline_fare ?? 'unknown'} for a return from ${context.baseline_airport_name ?? 'Heathrow'} — the closest airport to your school — to ${destinationName} on ${baselineDepartureLabel || 'the first Saturday'}. That's the fare. The real all-in cost is around £${context.baseline_allin ?? 'unknown'}. We checked ${context.combinationCount > 0 ? context.combinationCount : '128'} combinations to see if anything came out lower."

OTHERWISE (saving_category = 'significant' or 'found_saving'):
${otherwiseProblemStatement}

Rules:
- Always use the borough — "Most Harrow families" not "Most families"
- Never say "typical booking" or "standard booking"
- Never use decimal places
- baseline_fare and baseline_allin come from SELECTION CONTEXT — never invent numbers

──────────────────────────────────────────
INSIGHT CARDS
──────────────────────────────────────────
The CARDS array below has already been chosen. Do not add, drop, or reorder cards.

For EACH card write only:
  "i":       the card's index (0-based)
  "headline": "Copy locked_headline from facts EXACTLY — do not rephrase, do not shorten, do not add words. If locked_headline is not in facts, write 5 words max."
  "insight":  Guided by the card's "voice" instruction. DEFAULT: ONE sentence, 25 words max, ONE fact. EXCEPTION: if "voice" says to include multiple elements or copy all sentences, output ALL of them — no word limit applies.

Rules:
- Use ONLY values from that card's "facts". Never invent a number.
- Every £ value in "facts" is pre-rounded — copy exactly, no decimals.
- Never state carrier baggage policy. Only report what cost fields show.
- Never chain clauses with dashes or semicolons to fit more in. One fact. Cut instead.
- Never use the word "baseline" or "unfortunately".
- The fields outbound_cabin_bag_cost_gbp and return_cabin_bag_cost_gbp refer to CABIN BAGS only. Never use the word "checked" when describing these fields. If the insight mentions bags from these fields, always say "cabin bags" or "cabin bag charge" — never "checked bags".
- Transport return cards describe getting HOME from a London airport, not getting TO an airport. The family has just landed. Never say "Uber to [airport]" in a return card — always "Uber from [airport]" or "getting home from [airport]".
- Uber price ranges must be rounded to the nearest £5 for display. £49–£68 becomes £50–£70. £118–£166 becomes £120–£165. Apply this rounding to all Uber ranges in all cards and in the early_return_warning facts. The facts object pre-rounds these values — use them exactly as provided.

CARDS:
${JSON.stringify(finalCards, null, 2)}

──────────────────────────────────────────
SCENARIO CARDS
──────────────────────────────────────────
For each scenario below, write ONE sentence (max 20 words)
describing what the parent gets or saves. Use only the
values in facts. Copy numbers exactly — never calculate.
EXCEPTION: if a scenario's facts include reconciled_body, copy that
string from facts VERBATIM instead — no word limit, do not summarise
or shorten it.

Rules:
- travel_light: if bags_included is true, write "${cn(context.baseline_carrier ?? 'BA')} includes cabin bags in the fare, so removing them makes no difference to your total. If you switched to a budget carrier, removing bags would matter — but not here." Otherwise lead with the saving and action
- skip_seats: mention the caveat (may not sit together)
- add_checked_bag: copy facts.reconciled_body VERBATIM — it already reconciles the bag fee against the net cost so the headline and body never disagree. Never independently mention bag_fee_cost or uber_xl_delta.
- transport_flip (is_uber scenario, costs more): "Your outbound Uber to {origin_airport} is already included in the £{current_total} — the {outbound_departure_time} departure is early enough that Uber was the better choice. This scenario adds Uber home from {origin_airport} and taxi from {destination_name} airport — door-to-door both ends." Do NOT say "Uber to" the airport — only what changes vs the recommended route.
- transport_flip (saves money): lead with the saving
- transport_all_transit: if saves_money is true, write "Replaces Uber to {origin_airport} with public transport, even for the {outbound_departure_time} departure. Saves £{delta}, total £{scenario_total}." If costs_more is true, write "Replaces Uber to {origin_airport} with public transport, even for the {outbound_departure_time} departure. Costs £{delta} more than smart transport, total £{scenario_total}." If delta is 0, write "No Uber in the smart route, so forcing public transport makes no difference."
- If flight_changes is true: mention "different flight"

Return as:
"scenarios": [
  { "lever": "<lever>", "insight": "<sentence>" }
]

SCENARIOS:
${JSON.stringify((context.scenarios ?? []).map(s => ({
  lever:           s.lever,
  locked_headline: s.locked_headline,
  facts:           s.facts,
})), null, 2)}

──────────────────────────────────────────
CAVEATS
──────────────────────────────────────────
Maximum 1 caveat.
IF is_baseline_cheapest is true: "Prices observed ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. Book direct with ${cn(context.baseline_carrier ?? 'BA')}."
ELSE IF recommended.baggage_is_estimate is true: "Bag fees for [carrier] are estimates — actual price may vary by route and demand."
ELSE: return empty array.

──────────────────────────────────────────
CRITICAL: Return ONLY valid JSON. Start with { end with }.

{
  "problem_statement": "<2 sentences>",
  "headline": "<one sentence>",
  "subheadline": "<one sentence>",
  "cards": [
    { "i": 0, "headline": "<5 words>", "insight": "<25 words max>" }
  ],
  "scenarios": [
    { "lever": "<lever>", "insight": "<20 words max>" }
  ],
  "caveats": ["<string>"]
}`;

  console.log('[getAIRecommendation] insight prompt length (chars):', insightPrompt.length);

  try {
    const insightStart = Date.now();
    const [insightMessage, priceMovementInsight] = await Promise.all([
      client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: insightPrompt }],
      }),
      priceMovementNarrationPromise,
    ]);
    console.log('[getAIRecommendation] insight call ms:', Date.now() - insightStart);

    const insightText = insightMessage.content[0]?.type === 'text' ? insightMessage.content[0].text : '';
    const cleanInsightText = insightText.replace(/```json|```/g, '').trim();
    console.log('[getAIRecommendation] raw insight response:', cleanInsightText);

    const insightJsonMatch = cleanInsightText.match(/\{[\s\S]*\}/);
    if (!insightJsonMatch) {
      console.error('[getAIRecommendation] No JSON in insight response:', cleanInsightText.slice(0, 200));
      return {
        problem_statement: '',
        headline: 'We found the best value option for your dates.',
        subheadline: '',
        recommendation_prose: 'We found the best value option for your dates.',
        lever_insights: [],
        right_column_cards: rightColumnCards,
        caveats: [],
        confidence,
        fallback: false,
        winner_outbound_date:    ctx.winner.outbound_date,
        winner_return_date:      ctx.winner.return_date,
        winner_outbound_carrier: ctx.winner.outbound_carrier,
      };
    }
    const insightParsed = JSON.parse(insightJsonMatch[0]);

    console.log('[getAIRecommendation] cards count:', insightParsed.cards?.length);
    console.log('[getAIRecommendation] headline:', insightParsed.headline);

    const scenarioInsights: Array<{ lever: string; insight: string }> =
      insightParsed.scenarios ?? [];

    // Stitch written copy back onto card specs — model never touches verified numbers
    const written: Array<{ i: number; headline: string; insight: string }> =
      insightParsed.cards ?? [];

    const lever_insights = finalCards.map((spec, i) => {
      const w = written.find(x => x.i === i);
      return {
        lever:          spec.lever,
        headline:       w?.headline ?? spec.headline_hint,
        insight:        w?.insight  ?? '',
        verified_field: spec.verified_field,
        verified_value: spec.verified_value,
        saving_gbp:     spec.saving_gbp,
        ...(spec.obvious ? { obvious: spec.obvious } : {}),
        ...(spec.optimal ? { optimal: spec.optimal } : {}),
      };
    }).filter(c => c.insight);

    // Price movement card — spliced in right after quality_advantage (always
    // index 0 when !isBaselineCheapest) and before penalty_notice, per
    // CLAUDE.md's card ordering. Its text comes from the separate narration
    // call above, not from `written` — it was never part of the CARDS array
    // sent to the mega-prompt.
    if (!isBaselineCheapest) {
      lever_insights.splice(1, 0, {
        lever: 'price_movement',
        headline: 'How this price has moved',
        insight: priceMovementInsight || 'Price history for this exact flight is not available right now.',
        verified_field: 'direction',
        verified_value: priceDirection,
        saving_gbp: null,
      });
    }

    return {
      problem_statement:       insightParsed.problem_statement  ?? '',
      headline:                insightParsed.headline            ?? 'We found the best value option for your dates.',
      subheadline:             insightParsed.subheadline         ?? '',
      recommendation_prose:    '',
      lever_insights,
      right_column_cards:      rightColumnCards,
      scenario_insights:       scenarioInsights,
      caveats:                 insightParsed.caveats             ?? [],
      confidence:              'high',
      fallback:                false,
      winner_outbound_date:    recommended.outbound_date,
      winner_return_date:      recommended.return_date,
      winner_outbound_carrier: recommended.outbound_carrier,
      price_movement: !isBaselineCheapest ? {
        checks_total:     context.price_checks_total ?? 0,
        checks_with_data: context.price_checks_with_data ?? 0,
        price_points:     context.price_points ?? [],
        direction:        priceDirection,
      } : undefined,
    };
  } catch (err) {
    console.error('[getAIRecommendation] Insight call error:', err);
    return {
      problem_statement: '',
      headline: 'We found the best value option for your dates.',
      subheadline: '',
      recommendation_prose: 'We found the best value option for your dates.',
      lever_insights: [],
      right_column_cards: rightColumnCards,
      caveats: [],
      confidence,
      fallback: false,
      winner_outbound_date:    ctx.winner.outbound_date,
      winner_return_date:      ctx.winner.return_date,
      winner_outbound_carrier: ctx.winner.outbound_carrier,
    };
  }
}
