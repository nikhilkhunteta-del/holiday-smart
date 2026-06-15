import Anthropic from '@anthropic-ai/sdk';
import type { ScoredCombination } from './buildCandidates';
import { selectCombination, type SelectionContext } from './selectCombination';
import type { ScenarioResult } from './buildScenarioResults';

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
  transitPreference?: 'auto' | 'uber' | null;
  scenarios?: ScenarioResult[];
  savingCategory: 'significant' | 'modest' | 'minimal' | 'baseline_cheapest';
  combinationCount: number;
  trueCheapest_total_cost?:  number;
  trueCheapest_trip_nights?: number;
  trueCheapest_outbound?:    string;
  trueCheapest_return?:      string;
  trueCheapest_carrier?:     string;
  baseline_eff_cost?:        number;
  baseline_out_dep_quality?: string;
  baseline_fare?:            number;
  baseline_allin?:           number;
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
    return_transit_changes: c.return_transit?.transit?.changes ?? null,
    return_uber_cost_gbp: c.return_transit?.uber?.mean_pence
      ? Math.round(c.return_transit.uber.mean_pence / 100) : null,
    return_uber_low_gbp: c.return_transit?.uber?.low_pence
      ? Math.round(c.return_transit.uber.low_pence / 100) : null,
    return_uber_high_gbp: c.return_transit?.uber?.high_pence
      ? Math.round(c.return_transit.uber.high_pence / 100) : null,
    destination_transfer_cost_gbp: c.destination_transfer_cost_gbp,
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
  const recommended = combinationsForPrompt.find(c =>
    c.outbound_date    === ctx.winner.outbound_date &&
    c.return_date      === ctx.winner.return_date &&
    c.origin_iata      === ctx.winner.origin_iata &&
    c.outbound_carrier === ctx.winner.outbound_carrier &&
    c.return_carrier   === ctx.winner.return_carrier
  ) ?? combinationsForPrompt[0];

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
  const isSigOrModest = context.savingCategory === 'significant' ||
    context.savingCategory === 'modest';
  const isMinimal = context.savingCategory === 'minimal';
  const isBaselineCheapest = context.savingCategory === 'baseline_cheapest';

  const combCount = context.combinationCount > 0
    ? `${context.combinationCount}+`
    : '100+';

  // ── LEAD CARD — only when no inset day ───────────────────────────────
  if (!recommended.is_inset_day) {
    if (isBaselineCheapest || isMinimal) {
      cards.push({
        lever: 'lead_research',
        headline_hint: `${combCount} combinations checked`,
        voice: `Tell the parent we did the research so they don't have to. We checked ${combCount} flight combinations across 5 London airports and every viable date in their half-term window. ${isBaselineCheapest ? 'The Heathrow option turned out to be the best option — say this with confidence, not apology.' : 'Here is what we found.'} One sentence. Confident, not apologetic.`,
        facts: {
          locked_headline:      `${combCount} combinations checked`,
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

  // All-in trap: cheapest base fare ≠ cheapest all-in
  // Find combination with lowest outbound_fare_gbp on same dates
  const allInTrap = (() => {
    const sameDates = combinationsForPrompt.filter(
      c => c.outbound_date === recommended.outbound_date &&
           c.return_date   === recommended.return_date &&
           c.origin_iata !== recommended.origin_iata
    );
    if (!sameDates.length) return null;

    const cheapestFarCombo = sameDates.reduce((best, c) =>
      (c.outbound_fare_gbp ?? Infinity) <
      (best.outbound_fare_gbp ?? Infinity) ? c : best
    , sameDates[0]);

    const cheapestFare = cheapestFarCombo.outbound_fare_gbp;
    const cheapestFareAllin = round(cheapestFarCombo.total_cost_gbp);
    const recAllin = round(recommended.total_cost_gbp);
    const allinDiff = cheapestFareAllin - recAllin;

    // Only surface if cheaper fare ends up MORE expensive all-in by at least £20
    if (allinDiff < 20) return null;

    const cheapDestTransfer   = round(cheapestFarCombo.destination_transfer_cost_gbp ?? 0);
    const recBaseFare         = round((recommended.outbound_fare_gbp ?? 0) + (recommended.return_fare_gbp ?? 0));
    const hasExpensiveTransfer = cheapDestTransfer > 50;

    return {
      cheap_description:      `${cn(cheapestFarCombo.outbound_carrier)} from ${cheapestFarCombo.origin_iata} on ${fmtD(cheapestFarCombo.outbound_date)}, returning ${fmtD(cheapestFarCombo.return_date)}`,
      cheap_fare:             round(cheapestFare ?? 0),
      cheap_allin:            cheapestFareAllin,
      cheap_dest_transfer:    cheapDestTransfer,
      has_expensive_transfer: hasExpensiveTransfer,
      cheap_dest_iata:        cheapestFarCombo.out_dest_iata,
      rec_description:        `${cn(recommended.outbound_carrier)} from ${recommended.origin_iata}`,
      rec_base_fare:          recBaseFare,
      rec_allin:              recAllin,
      allin_saving:           allinDiff,
    };
  })();

  console.log('[airport-debug] allInTrap:', JSON.stringify(allInTrap));

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
  if (recommended.return_departure_quality === 'very_early') {
    const retDep      = recommended.return_departure_time ?? '05:00';
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

  if (isMinimal) {
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

    // Card 1 — Research lead (reuse if exists)
    const existingLead = finalCards.find(c => c.lever === 'lead_research');
    if (existingLead) baselineCards.push(existingLead);

    // Card 2 — Why baseline wins
    baselineCards.push({
      lever: 'baseline_wins',
      headline_hint: 'The direct booking wins',
      voice: `Explain why the BA round-trip (£${context.benchmarkCost}) beats every two-leg combination we found (cheapest two-leg: £${context.trueCheapest_total_cost}).

The reason: BA round-trip fares sometimes undercut the sum of two one-ways, and bags are included in the BA fare whereas LCC two-leg combinations charge separately.

One sentence. Specific numbers from facts. Never apologetic — this is a valid and trustworthy conclusion.`,
      facts: {
        locked_headline:   'The direct booking wins',
        baseline_total:    context.benchmarkCost ?? null,
        cheapest_two_leg:  context.trueCheapest_total_cost ?? null,
        diff: context.trueCheapest_total_cost && context.benchmarkCost
          ? Math.round(context.trueCheapest_total_cost - context.benchmarkCost)
          : null,
      },
      verified_field: 'total_cost_gbp',
      verified_value:  context.benchmarkCost ?? 0,
      saving_gbp: null,
    });

    // Card 3 — Inset day exists but wasn't recommended
    const insetCombo = combinationsForPrompt.find(
      c => c.is_inset_day && !c.requires_absence
    );
    if (insetCombo) {
      const insetRetTime = insetCombo.return_departure_time?.slice(0, 5) ?? '05:20';
      baselineCards.push({
        lever: 'inset_day_not_picked',
        headline_hint: 'Inset day option exists',
        voice: `Your school has an inset day on ${fmtD(insetCombo.outbound_date)}. Flying that day gives ${insetCombo.trip_nights} nights with zero absence and costs £${round(insetCombo.total_cost_gbp)}.

We didn't recommend it because the return departs Barcelona at ${insetRetTime} — meaning a 03:00–03:30 hotel checkout.

One sentence. Mention the inset date, the cost, and the early return time. End with: "If you're comfortable with that, check the date matrix below."`,
        facts: {
          locked_headline: 'Inset day option exists',
          inset_date:  fmtD(insetCombo.outbound_date),
          inset_total: round(insetCombo.total_cost_gbp),
          return_time: insetRetTime,
        },
        verified_field: 'total_cost_gbp',
        verified_value:  round(insetCombo.total_cost_gbp),
        saving_gbp: null,
      });
    }

    // Card 4 — Google Flights education (permanent)
    const educationCard = finalCards.find(c => c.lever === 'allin_trap');
    if (educationCard) baselineCards.push(educationCard);

    finalCards = baselineCards;
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

──────────────────────────────────────────
HEADLINE
──────────────────────────────────────────
IF is_baseline_cheapest is true, write instead:
  "The direct BA round-trip from Heathrow is the best option this window — £[baseline_total] all-in, bags included."
  Do not use "We found". Lead with the conclusion.

OTHERWISE, HEADLINE MUST follow one of these exact formats. Always compare cost against baseline (baseline_cost), not against trueCheapest.

FORMAT A — recommended costs MORE than baseline but gets more nights than trueCheapest (baseline_diff > 0, nights_diff > 0):
  "We found [trip_nights] nights in [destinationName] for £[total] — £[baseline_diff] more than the typical booking, but one extra night."
  Use "just £[baseline_diff] more" only if baseline_diff < 30.

FORMAT B — recommended costs LESS than baseline (baseline_diff < 0):
  "We found [trip_nights] nights in [destinationName] for £[total] — £[abs(baseline_diff)] less than the typical booking."

FORMAT C — recommended costs same as baseline (within £10 either way):
  "We found [trip_nights] nights in [destinationName] for £[total] — same price as the typical booking, better routing."

FORMAT D — minimal saving, no strong comparison:
  "We found [trip_nights] nights in [destinationName] for £[total] — here's the optimal routing."

RULES:
- baseline_diff = recommended.total_cost_gbp − baseline_cost (positive = we cost more)
- Always compare against baseline, never against trueCheapest
- If baseline_diff > 0: explain what the extra money buys (extra night, better airport)
- If baseline_diff < 0: lead with the saving
- Never say "cheapest option" in the headline

FORMAT E — inset day adds extra night:
  "We found ${destinationName} for £[total] — a full extra night on the inset day, £[benchmarkSaving] less than booking from Heathrow."

RULES:
- Never say "cheapest option" in the headline
- Never say "typical booking" or "standard booking"
- Never use decimal places
- Always lead with nights or saving, not departure mechanic

SUBHEADLINE
One sentence explaining the 2–3 key optimisations in plain English.
Do not repeat the cost. No numbers.
Example: "Flying on the inset day, mixing carriers, and taking the bus to Luton Airport."

PROBLEM STATEMENT
The problem statement always leads with the Google Flights fare vs all-in reality — regardless of whether our pick wins or the baseline wins.

Use these values from SELECTION CONTEXT:
- baseline_fare = what Google Flights shows for the BA round-trip
- baseline_allin = what it actually costs (fare + bags + transport)

Format (for ALL cases including is_baseline_cheapest):
"Most ${context.borough ?? 'London'} families search Google Flights and see £[baseline_fare] for ${destinationName} this half-term. All-in — bags, transport to the airport, transfers — it's £[baseline_allin]. We checked ${context.combinationCount > 0 ? context.combinationCount + '+' : '100+'} combinations to see if we could beat it."

IF is_baseline_cheapest is true, add a fourth sentence:
"This time, the direct BA round-trip from Heathrow is the best answer."

IF is_baseline_cheapest is false, add instead:
"Here's what we found."

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
  "insight":  ONE sentence, 25 words max, ONE fact, guided by the card's "voice" instruction

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

Rules:
- travel_light: lead with the saving and action
- skip_seats: mention the caveat (may not sit together)
- transport_flip (costs more): frame as convenience
  upgrade, mention Uber range from facts
- transport_flip (saves money): lead with the saving
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
Maximum 1 caveat. Only include if recommended.baggage_is_estimate is true: "Bag fees for [carrier] are estimates — actual price may vary by route and demand."
If baggage_is_estimate is false: return empty array.

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
    const insightMessage = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: insightPrompt }],
    });
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
