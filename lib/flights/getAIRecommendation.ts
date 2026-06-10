import Anthropic from '@anthropic-ai/sdk';
import type { ScoredCombination } from './buildCandidates';

export interface AIRecommendationOutput {
  recommended_index: number;
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
}

export async function getAIRecommendation(
  combinations: ScoredCombination[],
  context: FamilyContext,
): Promise<AIRecommendationOutput> {

  const FALLBACK: AIRecommendationOutput = {
    recommended_index: 0,
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
    // Pre-computed quality fields from buildCandidates.ts — use directly
    trip_nights: c.trip_nights,
    arrival_quality: c.arrival_quality,
    outbound_departure_quality: c.outbound_departure_quality,
    return_departure_quality: c.return_departure_quality,
    total_outbound_travel_mins: c.total_outbound_travel_mins,
    pre_score: c.pre_score,
  }));

  // ── Call 1 — Pick the best combination ───────────────────────────────────
  const pickPrompt = `You are advising a London family booking a school holiday flight. Pick the single best combination from the shortlist below.

FAMILY:
- School: ${context.schoolName ?? 'unknown'}, ${context.borough ?? 'London'} (${context.postcodeDistrict})
- Party: ${context.adults} adults, ${context.children} children${context.infants ? `, ${context.infants} infants` : ''}
- Window: ${context.windowStart} to ${context.windowEnd}
- Bags: ${context.cabinBags} cabin bags, ${context.checkedBags} checked bags
- Seats together: yes (already included in seat_cost_gbp)

SHORTLIST (${combinations.length} curated candidates — each represents the best of its type):
${JSON.stringify(combinationsForPrompt, null, 2)}

SCORING FRAMEWORK:
Score each combination out of 100 internally. Do NOT write out your scoring — output only the JSON. All reasoning goes inside picking_reasoning only.

COST SCORE (35 points):
- Cheapest combination = 35 points
- Each £25 more expensive = -1 point
- Floor: 15 points

INSET DAY BONUS (10 points):
- is_inset_day: true AND arrival_quality 'excellent' or 'good': 10 points
  (genuine extra day — family arrives in time to use it)
- is_inset_day: true AND arrival_quality 'acceptable': 3 points
  (no absence benefit only — not a usable extra day)
- is_inset_day: true AND arrival_quality 'poor': 0 points
  (flying a day early but arriving at night — no benefit)
- is_inset_day: false: 0 points

ARRIVAL QUALITY SCORE (20 points):
- 'excellent' (before 14:00): 20 points
- 'good' (14:00–18:00): 15 points
- 'acceptable' (18:00–21:00): 6 points
- 'poor' (after 21:00): 0 points

OUTBOUND DEPARTURE QUALITY SCORE (15 points):
- 'ideal' (09:00–13:00): 15 points — comfortable morning, arrives with time to enjoy destination
- 'good' (13:00–17:00): 10 points — relaxed but arrives late afternoon
- 'very_early' (before 09:00): 6 points — stressful but compensated by early arrival
- 'poor' (after 17:00): 2 points — arrives at night, first day wasted

RETURN DEPARTURE QUALITY SCORE (15 points):
- 'excellent' (after 17:00): 15 points — full last day at destination
- 'good' (13:00–17:00): 12 points — most of last day usable
- 'early' (09:00–13:00): 5 points — morning checkout only, last day mostly lost
- 'very_early' (before 09:00): 2 points — last day completely lost

JOURNEY EASE SCORE (5 points):
- 0 transit changes AND total_outbound_travel_mins < 90: 5 points
- 0 transit changes AND total_outbound_travel_mins 90–120: 4 points
- 1 transit change: 3 points
- 2+ transit changes: 1 point
- null: 3 points

PICK: highest total score wins.
If two combinations score within 2 points of each other, pick the cheaper one.

FINAL CHECK before confirming your pick:
1. Is there any combination with is_inset_day: true AND arrival_quality 'excellent' or 'good'? If yes and you have not picked it, explain why not.
2. Does your pick have outbound_departure_quality 'poor' (after 17:00)? If yes, is the cost saving vs the next 'ideal' or 'good' departure worth arriving at night?
3. Does your pick have return_departure_quality 'very_early' (before 09:00)? If yes, is the cost saving vs the next 'early' or 'good' return worth losing the last day entirely?
4. Is there a combination within £30 where the family gets meaningfully more usable holiday time?
5. If your pick costs more than the cheapest combination, state the exact cost difference in picking_reasoning. Example: "costs £33 more than the cheapest option (index 6 at £702.40)."

IMPORTANT:
- fine_gbp is already included in total_inc_fine
- Do not penalise split_carrier — mixing airlines is fine and often saves money
- Never celebrate an inset day departure that arrives after 18:00 as giving an "extra day" — it does not
- The cheapest option is not always the best — but always justify any pick that costs more
- When comparing trip_nights between two combinations, always state the DIFFERENCE not the absolute value. Example: "index 1 has 1 more night than index 6" not "index 1 has 4 trip nights". The difference is what matters for the parent.

CRITICAL: Return ONLY the JSON object. Start with { and end with }.

{
  "recommended_index": <number>,
  "confidence": "<high|medium|low>",
  "picking_reasoning": "<2-3 sentences explaining why this combination wins — what trade-offs did you consider? Internal use only, not shown to parent.>"
}`;

  let recommendedIndex = 0;
  let pickingReasoning = '';
  let confidence: 'high' | 'medium' | 'low' = 'low';

  try {
    const pickStart = Date.now();
    const { data: pickMessage, response: pickRawResponse } = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: pickPrompt }],
    }).withResponse();
    console.log('[getAIRecommendation] pick call ms:', Date.now() - pickStart);
    console.log('[getAIRecommendation] pick response status:', pickRawResponse.status);
    console.log('[getAIRecommendation] pick response cached:', pickRawResponse.headers.get('cf-cache-status'));

    const pickText = pickMessage.content[0]?.type === 'text' ? pickMessage.content[0].text : '';
    const cleanPickText = pickText.replace(/```json|```/g, '').trim();
    const pickJsonMatch = cleanPickText.match(/\{[\s\S]*\}/);
    if (!pickJsonMatch) {
      console.error('[getAIRecommendation] No JSON in pick response:', cleanPickText.slice(0, 200));
      return FALLBACK;
    }
    const pickParsed = JSON.parse(pickJsonMatch[0]);

    recommendedIndex = Math.max(0, Math.min(
      pickParsed.recommended_index ?? 0,
      combinations.length - 1,
    ));
    pickingReasoning = pickParsed.picking_reasoning ?? '';
    confidence = pickParsed.confidence ?? 'low';

    console.log('[getAIRecommendation] recommended_index:', recommendedIndex);
    console.log('[getAIRecommendation] picking_reasoning:', pickingReasoning);
  } catch (err) {
    console.error('[getAIRecommendation] Pick call error:', err);
    return FALLBACK;
  }

  // ── Call 2 — Generate headline + insights ─────────────────────────────────
  const recommended = combinationsForPrompt[recommendedIndex];

  const sameDates = combinationsForPrompt.filter(
    c => c.outbound_date === recommended.outbound_date &&
         c.return_date === recommended.return_date,
  );

  const cheapestInset = combinationsForPrompt
    .filter(c => c.is_inset_day)
    .sort((a, b) => a.total_inc_fine - b.total_inc_fine)[0] ?? null;

  const cheapestNonInset = combinationsForPrompt
    .filter(c => !c.is_inset_day)
    .sort((a, b) => a.total_inc_fine - b.total_inc_fine)[0] ?? null;

  const cheapestAbsence = combinationsForPrompt
    .filter(c => c.requires_absence && c.total_inc_fine < recommended.total_inc_fine)
    .sort((a, b) => a.total_inc_fine - b.total_inc_fine)[0] ?? null;

  // Pre-computed same-date summaries
  const depAirportSummary = Array.from(
    sameDates.reduce((map, c) => {
      const existing = map.get(c.origin_iata);
      if (!existing || c.total_cost_gbp < (existing as any).total_cost_gbp) {
        map.set(c.origin_iata, {
          origin_iata: c.origin_iata,
          total_cost_gbp: c.total_cost_gbp,
          outbound_transit_route: c.outbound_transit_route,
          outbound_transit_duration_mins: c.outbound_transit_duration_mins,
        });
      }
      return map;
    }, new Map<string, object>()).values(),
  ).sort((a: any, b: any) => a.total_cost_gbp - b.total_cost_gbp);

  const outDestSummary = Array.from(
    sameDates.reduce((map, c) => {
      const existing = map.get(c.out_dest_iata);
      if (!existing || c.total_cost_gbp < (existing as any).total_cost_gbp) {
        map.set(c.out_dest_iata, {
          out_dest_iata: c.out_dest_iata,
          total_cost_gbp: c.total_cost_gbp,
          destination_transfer_cost_gbp: c.destination_transfer_cost_gbp,
        });
      }
      return map;
    }, new Map<string, object>()).values(),
  ).sort((a: any, b: any) => a.total_cost_gbp - b.total_cost_gbp);

  const retDestSummary = Array.from(
    sameDates.reduce((map, c) => {
      const existing = map.get(c.ret_dest_iata);
      if (!existing || c.total_cost_gbp < (existing as any).total_cost_gbp) {
        map.set(c.ret_dest_iata, {
          ret_dest_iata: c.ret_dest_iata,
          total_cost_gbp: c.total_cost_gbp,
        });
      }
      return map;
    }, new Map<string, object>()).values(),
  ).sort((a: any, b: any) => a.total_cost_gbp - b.total_cost_gbp);

  const cheapestSplit = sameDates
    .filter(c => c.split_carrier)
    .sort((a, b) => a.total_cost_gbp - b.total_cost_gbp)[0] ?? null;
  const cheapestSingle = sameDates
    .filter(c => !c.split_carrier)
    .sort((a, b) => a.total_cost_gbp - b.total_cost_gbp)[0] ?? null;

  const splitCarrierSummary = {
    recommended_is_split: recommended.split_carrier,
    cheapest_split: cheapestSplit ? {
      total_cost_gbp: cheapestSplit.total_cost_gbp,
      outbound_carrier: cheapestSplit.outbound_carrier,
      return_carrier: cheapestSplit.return_carrier,
    } : null,
    cheapest_single: cheapestSingle ? {
      total_cost_gbp: cheapestSingle.total_cost_gbp,
      outbound_carrier: cheapestSingle.outbound_carrier,
    } : null,
    saving_gbp: (cheapestSplit && cheapestSingle)
      ? Math.round((cheapestSingle.total_cost_gbp - cheapestSplit.total_cost_gbp) * 100) / 100
      : null,
  };

  // Benchmark saving for headline
  const benchmarkSaving = context.benchmarkCost != null
    ? Math.round((context.benchmarkCost - recommended.total_inc_fine) * 100) / 100
    : null;

  const insightPrompt = `You are a financial intelligence tool helping a London family save money on their school holiday flight. Generate a headline, subheadline, prose and insights based ONLY on the pre-computed data below. Do not calculate anything yourself.

RECOMMENDED COMBINATION:
${JSON.stringify(recommended, null, 2)}

WHY THIS WAS PICKED (use this to write headline + prose):
${pickingReasoning}

BENCHMARK CONTEXT:
- Typical Saturday booking cost for this family on this route: ${context.benchmarkCost != null ? `£${context.benchmarkCost}` : 'not available'}
- Saving vs typical Saturday booking: ${benchmarkSaving != null ? `£${benchmarkSaving}` : 'not available'}

SAME-DATE SUMMARIES (pre-computed — use directly):

DEPARTURE AIRPORTS:
${JSON.stringify(depAirportSummary, null, 2)}

OUTBOUND ARRIVAL AIRPORTS:
${JSON.stringify(outDestSummary, null, 2)}

RETURN ARRIVAL AIRPORTS:
${JSON.stringify(retDestSummary, null, 2)}

SPLIT CARRIER vs SINGLE CARRIER:
${JSON.stringify(splitCarrierSummary, null, 2)}

CROSS-DATE LEVERS (pre-computed):
${JSON.stringify({
  inset_day: {
    cheapest_inset_total_inc_fine: cheapestInset?.total_inc_fine ?? null,
    cheapest_inset_outbound_date: cheapestInset?.outbound_date ?? null,
    cheapest_inset_is_recommended: cheapestInset?.index === recommendedIndex,
    cheapest_non_inset_total_inc_fine: cheapestNonInset?.total_inc_fine ?? null,
    inset_saving_vs_non_inset: (cheapestNonInset && cheapestInset)
      ? Math.round((cheapestNonInset.total_inc_fine - cheapestInset.total_inc_fine) * 100) / 100
      : null,
    inset_extra_nights: (cheapestInset && cheapestNonInset)
      ? cheapestInset.trip_nights - cheapestNonInset.trip_nights
      : null,
  },
  absence_tradeoff: {
    cheapest_absence_total_inc_fine: cheapestAbsence?.total_inc_fine ?? null,
    cheapest_absence_outbound_date: cheapestAbsence?.outbound_date ?? null,
    cheapest_absence_fine_gbp: cheapestAbsence?.fine_gbp ?? null,
    cheapest_absence_absence_days: cheapestAbsence?.absence_days ?? null,
    net_saving_vs_recommended: cheapestAbsence
      ? Math.round((recommended.total_inc_fine - cheapestAbsence.total_inc_fine) * 100) / 100
      : null,
  },
}, null, 2)}

FAMILY CONTEXT:
- School: ${context.schoolName ?? 'unknown'}, ${context.borough ?? 'London'} (${context.postcodeDistrict})
- Party: ${context.adults} adults, ${context.children} children
- Bags: ${context.cabinBags} cabin bags, ${context.checkedBags} checked bags

INSTRUCTIONS:

HEADLINE:
One punchy sentence. Must include the recommended cost (£${recommended.total_inc_fine}).
${benchmarkSaving != null && benchmarkSaving > 0
  ? `Include the saving vs typical Saturday booking: "£${benchmarkSaving} less than a typical Saturday booking from ${recommended.origin_iata}."`
  : 'Do not mention a saving vs typical booking — data not available.'}
Always say "from Heathrow" in the benchmark comparison — never name any other airport. The benchmark is always the LHR Saturday booking regardless of which airport the recommended combination uses.
Example: "We found Barcelona for £703 — £144 less than a typical Saturday booking from Heathrow."

SUBHEADLINE:
One sentence explaining HOW we saved the money — the key levers in plain English.
Do not repeat the cost. Focus on the 2-3 most important optimisations.
Example: "Flying Thursday on the inset day, mixing BA and Ryanair, and taking the bus to Heathrow."

RECOMMENDATION PROSE:
2-3 sentences directly to the parent explaining the overall pick.
- Reference actual times, costs, dates from the recommended combination
- If not cheapest, explain what extra value it provides
- If the recommended combination is NOT the cheapest option on these dates, the prose MUST acknowledge this explicitly in the first or second sentence: "This costs £[X] more than the cheapest option on these dates — [reason why it's worth it]." Do not bury this. The parent will notice and trust you more for being upfront.
- Mention arrival quality honestly — if arriving after 18:00, do not call it an "extra day"
- Mention the inset day benefit if is_inset_day: true AND arrival_quality is 'excellent' or 'good'
- Warm, direct, specific — knowledgeable friend voice
- Do not say "baseline" — say "most families booking this week" or "typical Saturday booking"
- Do not mention seat selection policy, transit accuracy, or generic booking advice

LEVER INSIGHTS:
Check each lever. Only include if condition is met.

MANDATORY — VALUE TRADE-OFF CARD

Find the combination with the lowest total_inc_fine across all combinations.

Case A — recommended IS the cheapest:
  Do NOT surface this lever.

Case B — recommended is NOT the cheapest:
  ALWAYS surface this lever first, before any other lever card.

  If recommended has more trip_nights than cheapest:
    "lever": "value_tradeoff",
    "headline": "We didn't pick the cheapest — here's why",
    "insight": "The cheapest option is £[cheapest_total] — £[diff] less. But it departs [cheapest_date] ([cheapest_day]), giving [N] fewer night[s] in [destination]. At £[cost_per_extra_night] per extra night, we judged that better value.",
    "saving_gbp": null,
    "verified_field": "total_inc_fine",
    "verified_value": [recommended total_inc_fine]

  If recommended has same trip_nights but better arrival/departure quality:
    "lever": "value_tradeoff",
    "headline": "We didn't pick the cheapest — here's why",
    "insight": "The cheapest option is £[cheapest_total] — £[diff] less, but [reason: arrives at night / very early return / poor departure time]. We picked the option that gives you a usable day.",
    "saving_gbp": null,
    "verified_field": "total_inc_fine",
    "verified_value": [recommended total_inc_fine]

MANDATORY CHECK — ALL-IN COST TRAP

Look at all outbound flight options on the recommended outbound date.
Find the option with the lowest outbound fare (lowest fare_gbp or party_fare_gbp).

If that lowest-fare option has a higher all-in total cost (fare + bags + seats + transport) than the recommended option, AND the difference in all-in total is £30 or more:

Surface a lever with:
  "lever": "allin_trap",
  "headline": "The cheapest fare isn't the cheapest trip",
  "insight": "The cheapest fare on these dates is £[lowest_fare] ([carrier] from [airport]). All-in with bags, seats and transport to the airport: £[lowest_allin]. The [recommended_carrier] fare of £[rec_fare] costs £[fare_diff] more as a fare — but £[allin_saving] less all-in once everything is included.",
  "saving_gbp": [allin_saving]

If the cheapest fare IS also the cheapest all-in, or the difference is less than £30: do NOT surface this lever.

CROSS-DATE LEVERS:

1. INSET DAY
Use: cross_date_levers.inset_day
Case A — cheapest_inset_is_recommended TRUE: ALWAYS surface.
  - arrival_quality 'excellent' or 'good': "Departing on [date] — [school_name]'s inset day — means zero school absence and zero fines. Flying [day] instead of Saturday also means you beat the half-term rush — airports are significantly quieter the day before the holiday weekend starts."
  - arrival_quality 'acceptable': "Departing on [date] — the inset day — means no school absence or fines, though the [arrival_time] arrival means most of the first day is a travel day."
  - arrival_quality 'poor': Note no absence only. Never say "extra day" for arrivals after 21:00.
Case B — cheapest_inset_is_recommended FALSE: Only if inset_saving_vs_non_inset > 0 OR inset_extra_nights > 0. Frame as alternative.
If inset more expensive with no extra nights: DO NOT surface.

2. ABSENCE TRADE-OFF
Condition: net_saving_vs_recommended > 20. Neutral framing with actual numbers.
If ≤ £20: DO NOT surface.

SAME-DATE LEVERS:

3. DEPARTURE AIRPORT
Condition: dep_airport_summary has >1 entry AND the most expensive entry costs >£20 more than the cheapest.
ONLY surface if the recommended combination is NOT already at the cheapest airport.
If recommended.origin_iata === dep_airport_summary[0].origin_iata (cheapest): DO NOT surface this lever.
If recommended is NOT cheapest: "Switching from [recommended_airport] to [cheaper_airport] saves £[diff] on these dates — [transit_route] gets you there in [mins] mins."

4. OUTBOUND ARRIVAL AIRPORT
Condition: out_dest_summary has >1 entry AND cost difference > £20.
ONLY surface if recommended.out_dest_iata is NOT already the cheapest.
If recommended IS cheapest: DO NOT surface.
If recommended is NOT cheapest: state the saving from switching.

5. RETURN ARRIVAL AIRPORT
Condition: ret_dest_summary has >1 entry AND cost difference > £20.
ONLY surface if recommended.ret_dest_iata is NOT already the cheapest.
If recommended IS cheapest: DO NOT surface.
If recommended is NOT cheapest: state the saving from switching.

6. SPLIT CARRIER
Condition: splitCarrierSummary.saving_gbp > 20. ALWAYS positive framing.
"We found cheaper by combining [outbound_carrier] outbound and [return_carrier] return — saves £[saving_gbp] vs the cheapest single-airline booking."
If saving ≤ 20 or null: DO NOT surface.

RECOMMENDED COMBINATION LEVERS:

7. TRAVEL LIGHT — CABIN BAGS
MANDATORY if cabin_bag_cost_gbp > 0.
Per-leg framing: note which carrier charges and which includes bags.
"[Outbound carrier] includes cabin bags. [Return carrier] charges £[return_cabin_bag_cost_gbp] for your [N] bags on the return leg. Travelling with personal items only on the return removes this cost."
saving_gbp: return_cabin_bag_cost_gbp (only the chargeable leg)

8. CHECKED BAGS
Condition: checked_bag_cost_gbp > 0. Always surface if true.

9. TRANSPORT — OUTBOUND
Condition: both transit and Uber costs exist AND (cost diff > £20 OR time diff > 45 mins).
Include route name and specific times.

10. TRANSPORT — RETURN
IMPORTANT: The return leg means the family is ARRIVING at a London airport and travelling HOME. Return transit = getting from the arrival airport to home, not getting to an airport. Never describe this as "getting to the airport" or mention check-in, departures, or airport terminals for the return leg. Frame around: "Getting home from [airport] costs £[X] by transit / £[Y]–£[Z] by Uber."
Same pattern. If return_departure_quality 'very_early' and 2+ changes:
Frame around convenience — Uber may be worth the extra.
saving_gbp: null when recommending Uber over cheaper transit.

11. TRANSIT CHANGES
Only if not already covered by transport insight for that leg.
Condition: outbound_transit_changes >= 2 OR return_transit_changes >= 2.

STRICT RULES:
- Transit and Uber times are approximate — always say "around X minutes" or "roughly X minutes", never a precise figure. Round to the nearest 5 minutes in copy.
- Uber costs are a range, not a fact. Always present as "£[low]–£[high] by Uber" using outbound_uber_low_gbp / outbound_uber_high_gbp (or return equivalents). Never present a single Uber price as exact.
- Minimum threshold for financial lever cards: only surface a lever with saving_gbp if the saving is ≥ £40 OR ≥ 5% of recommended total_cost_gbp, whichever is lower. Levers below this threshold should be omitted entirely — do not surface them with a reduced saving_gbp. Exception: the value_tradeoff and allin_trap levers are always surfaced regardless of saving amount.
- Use ONLY numbers from provided data — never calculate or invent
- Do not say "baseline"
- Maximum 1 caveat: only if baggage_is_estimate: true. Text: "Bag fees for [carrier] are estimated — actual price may vary by route."
- No caveat about seats
- Every verified_field must be an exact field name from the combinations data

CRITICAL: Return ONLY the JSON object. Start with { and end with }.

{
  "problem_statement": "<Exactly 2 sentences. What the typical uninformed parent from this school and borough does and pays. First sentence states what they do and the price — use baseline_total_gbp from the data exactly as a number, do not round or approximate it. Second sentence is: 'That\\'s the obvious route — but not the optimal one.' Example: 'Most Harrow families with children at Vaughan Primary School search Heathrow on a Saturday and pay around £[baseline_total_gbp] for Barcelona this half-term. That\\'s the obvious route — but not the optimal one.'",
  "headline": "<one punchy sentence with cost and saving vs typical booking>",
  "subheadline": "<one sentence explaining the key optimisations — no cost number>",
  "recommendation_prose": "<2-3 sentences to the parent>",
  "lever_insights": [
    {
      "lever": "<value_tradeoff|allin_trap|inset_day|absence_tradeoff|departure_airport|outbound_arrival_airport|return_arrival_airport|split_carrier|travel_light|checked_bags|transport_outbound|transport_return|transit_changes>",
      "headline": "<5 words max>",
      "insight": "<one sentence, specific, with actual numbers>",
      "saving_gbp": <number|null>,
      "verified_field": "<exact field name>",
      "verified_value": <actual value>,
      "obvious": "<optional — what most families do, one short phrase. Populate for levers: departure_airport, outbound_arrival_airport, return_arrival_airport, travel_light, checked_bags, transport_outbound, transport_return, split_carrier. Leave absent for inset_day and absence_tradeoff.>",
      "optimal": "<optional — what we found instead, one short phrase. Same levers as obvious.>"
    }
  ],
  "caveats": ["<string>"],
  "confidence": "<high|medium|low>"
}`;

  console.log('[getAIRecommendation] insight prompt length (chars):', insightPrompt.length);

  try {
    const insightStart = Date.now();
    const insightMessage = await client.messages.create({
      model: 'claude-haiku-4-5',
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
        recommended_index: recommendedIndex,
        problem_statement: '',
        headline: 'We found the best value option for your dates.',
        subheadline: '',
        recommendation_prose: 'We found the best value option for your dates.',
        lever_insights: [],
        caveats: [],
        confidence,
        fallback: false,
      };
    }
    const insightParsed = JSON.parse(insightJsonMatch[0]);

    console.log('[getAIRecommendation] lever count:', insightParsed.lever_insights?.length);
    console.log('[getAIRecommendation] headline:', insightParsed.headline);
    console.log('[getAIRecommendation] prose:', insightParsed.recommendation_prose);

    return {
      recommended_index: recommendedIndex,
      problem_statement: insightParsed.problem_statement ?? '',
      headline: insightParsed.headline ?? 'We found the best value option for your dates.',
      subheadline: insightParsed.subheadline ?? '',
      recommendation_prose: insightParsed.recommendation_prose ?? '',
      lever_insights: insightParsed.lever_insights ?? [],
      caveats: insightParsed.caveats ?? [],
      confidence: insightParsed.confidence ?? confidence,
      fallback: false,
    };
  } catch (err) {
    console.error('[getAIRecommendation] Insight call error:', err);
    return {
      recommended_index: recommendedIndex,
      problem_statement: '',
      headline: 'We found the best value option for your dates.',
      subheadline: '',
      recommendation_prose: 'We found the best value option for your dates.',
      lever_insights: [],
      caveats: [],
      confidence,
      fallback: false,
    };
  }
}
