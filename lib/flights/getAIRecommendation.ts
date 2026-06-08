import Anthropic from '@anthropic-ai/sdk';
import type { AssembledCombination } from './assembleRecommendation';

export interface AIRecommendationOutput {
  recommended_index: number;
  recommendation_prose: string;
  lever_insights: Array<{
    lever: string;
    headline?: string;
    insight: string;
    verified_field: string;
    verified_value: string | number | boolean;
    saving_gbp?: number;
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
}

export async function getAIRecommendation(
  combinations: AssembledCombination[],
  context: FamilyContext,
): Promise<AIRecommendationOutput> {

  const FALLBACK: AIRecommendationOutput = {
    recommended_index: 0,
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

  // ── Build compact combinations for prompt ─────────────────────────────────
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
    checked_bag_cost_gbp: c.checked_bag_cost_gbp,
    seat_cost_gbp: c.seat_cost_gbp,
    outbound_transit_cost_gbp: c.outbound_transit_cost_gbp,
    outbound_transit_route: c.outbound_transit?.transit?.route_summary ?? null,
    outbound_transit_duration_mins: c.outbound_transit?.transit?.duration_mins ?? null,
    outbound_transit_changes: c.outbound_transit?.transit?.changes ?? null,
    outbound_uber_cost_gbp: c.outbound_transit?.uber?.mean_pence
      ? Math.round(c.outbound_transit.uber.mean_pence / 100) : null,
    outbound_uber_duration_mins: c.outbound_transit?.uber?.duration_mins ?? null,
    outbound_early_warning: c.outbound_transit?.transit?.early_flight_warning ?? false,
    return_transit_cost_gbp: c.return_transit_cost_gbp,
    return_transit_route: c.return_transit?.transit?.route_summary ?? null,
    return_transit_changes: c.return_transit?.transit?.changes ?? null,
    return_uber_cost_gbp: c.return_transit?.uber?.mean_pence
      ? Math.round(c.return_transit.uber.mean_pence / 100) : null,
    destination_transfer_cost_gbp: c.destination_transfer_cost_gbp,
    baggage_is_estimate: c.baggage_is_estimate,
    total_cost_gbp: c.total_cost_gbp,
    total_inc_fine: c.total_inc_fine,
    trip_nights: Math.round(
      (new Date(c.return_date).getTime() - new Date(c.outbound_date).getTime())
      / (1000 * 60 * 60 * 24)
    ),
    arrival_quality: (() => {
      if (!c.outbound_arrival_time) return null;
      const hour = parseInt(c.outbound_arrival_time.split(':')[0]);
      if (hour < 14) return 'excellent';
      if (hour < 18) return 'good';
      if (hour < 21) return 'acceptable';
      return 'poor';
    })(),
    departure_quality: (() => {
      if (!c.return_departure_time) return null;
      const hour = parseInt(c.return_departure_time.split(':')[0]);
      if (hour < 6)  return 'very_early';
      if (hour < 9)  return 'early';
      if (hour < 14) return 'good';
      return 'excellent';
    })(),
    total_outbound_travel_mins: (
      (c.outbound_transit?.transit?.duration_mins ??
       c.outbound_transit?.uber?.duration_mins ?? 0) +
      (c.outbound_duration_mins ?? 0)
    ),
  }));

  console.log('[getAIRecommendation] combinations count:', combinationsForPrompt.length);

  const client = new Anthropic({ apiKey });

  // ── Call 1 — Pick the best combination ───────────────────────────────────
  const pickPrompt = `You are advising a London family booking a school holiday flight. Pick the single best combination from the list below.

FAMILY:
- School: ${context.schoolName ?? 'unknown'}, ${context.borough ?? 'London'} (${context.postcodeDistrict})
- Party: ${context.adults} adults, ${context.children} children${context.infants ? `, ${context.infants} infants` : ''}
- Window: ${context.windowStart} to ${context.windowEnd}
- Bags: ${context.cabinBags} cabin bags, ${context.checkedBags} checked bags
- Seats together: yes (already included in seat_cost_gbp)

ALL COMBINATIONS (${combinations.length} options):
${JSON.stringify(combinationsForPrompt, null, 2)}

PICKING HIERARCHY — apply in this order:

1. COST: total_inc_fine is the true all-in cost. Start here.

2. TRIP NIGHTS: If a combination has more trip_nights than the cheapest option
   and costs less than £25 per extra night more — prefer the longer trip.
   An extra night for under £25 is always worth it for a family holiday.
   Treat is_inset_day: true as equivalent to one free extra night.

3. ARRIVAL QUALITY: Between combinations within £30 of each other,
   prefer better arrival_quality. 'poor' (after 9pm with children)
   should be avoided unless saving exceeds £50.

4. DEPARTURE QUALITY: Between combinations within £30 of each other,
   prefer better departure_quality. 'very_early' (before 6am)
   should be avoided unless saving exceeds £50.

5. TRAVEL TIME: Between combinations within £30 of each other,
   prefer lower total_outbound_travel_mins.
   A shorter journey day matters for families with children.

6. TRANSIT CHANGES: Between combinations within £30 of each other,
   prefer fewer outbound_transit_changes.
   More changes with luggage and children is harder.

IMPORTANT:
- fine_gbp is already included in total_inc_fine — absence can still be best pick if net saving is significant
- is_inset_day: true is a strong positive — the family gets an extra holiday day at no school cost
- Do not penalise split_carrier — mixing airlines is fine and often saves money
- The cheapest option is not always the best — explain your reasoning

Return ONLY this JSON, no other text:
{
  "recommended_index": <number>,
  "confidence": "<high|medium|low>",
  "picking_reasoning": "<2-3 sentences explaining why this combination wins — what trade-offs did you consider? This is used internally, not shown to the parent.>"
}`;

  let recommendedIndex = 0;
  let pickingReasoning = '';
  let confidence: 'high' | 'medium' | 'low' = 'low';

  try {
    const pickStart = Date.now();
    const pickMessage = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{ role: 'user', content: pickPrompt }],
    });
    console.log('[getAIRecommendation] pick call ms:', Date.now() - pickStart);

    const pickText = pickMessage.content[0]?.type === 'text' ? pickMessage.content[0].text : '';
    const cleanPickText = pickText.replace(/```json|```/g, '').trim();
    const pickParsed = JSON.parse(cleanPickText);

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

  // ── Call 2 — Generate insights ────────────────────────────────────────────
  const recommended = combinationsForPrompt[recommendedIndex];

  const sameDates = combinationsForPrompt.filter(
    c => c.outbound_date === recommended.outbound_date &&
         c.return_date === recommended.return_date
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

  const insightPrompt = `You are a financial intelligence tool helping a London family save money on their school holiday flight. Generate insights based ONLY on the pre-computed data below. Do not calculate anything yourself — every number is already computed.

RECOMMENDED COMBINATION:
${JSON.stringify(recommended, null, 2)}

WHY THIS WAS PICKED (internal reasoning — use this to write the prose):
${pickingReasoning}

SAME-DATE OPTIONS (for airport, transport, split carrier levers — recommended dates only):
${JSON.stringify(sameDates, null, 2)}

CROSS-DATE LEVERS (pre-computed — use these numbers directly):
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

RECOMMENDATION PROSE:
Write 2-3 sentences directly to the parent explaining why this combination was chosen.
- Reference actual times, costs, dates, trip_nights from the recommended combination
- If it is not the cheapest, explain what extra value it provides (extra night, better arrival time, shorter journey)
- Use "most families booking this week" instead of "baseline"
- Warm, direct, specific — like a knowledgeable friend
- Do not mention seat selection policy, transit accuracy, or generic booking advice

LEVER INSIGHTS:
Check each lever below. Only include if condition is met.

CROSS-DATE LEVERS (use pre-computed values only — do not scan combinations):

1. INSET DAY
Use: cross_date_levers.inset_day
Condition: inset_saving_vs_non_inset > 0 (inset is cheaper) OR inset_extra_nights > 0 (same/similar cost, more nights)
Framing: ALWAYS positive
- If saving > 0: "Flying on [cheapest_inset_outbound_date] — your school's inset day — saves £[inset_saving_vs_non_inset] vs the next available date."
- If saving ≤ 0 but extra_nights > 0: "Flying on [date] — your school's inset day — costs the same but gives your family [N] extra night(s) in [destination]."
- If recommended combination IS the inset day: frame as "we chose the inset day departure — here's what that gives you"
- If inset is more expensive with no extra nights: DO NOT surface this lever

2. ABSENCE TRADE-OFF
Use: cross_date_levers.absence_tradeoff
Condition: net_saving_vs_recommended > 20
Framing: neutral, factual
"Flying on [date] costs £[total] including a £[fine] fine for [N] absence day(s) — still £[net_saving] less than the recommended option."
If net saving ≤ £20: DO NOT surface this lever

SAME-DATE LEVERS (use same_date_options data — recommended dates only):

3. DEPARTURE AIRPORT
Find cheapest total_cost_gbp per unique origin_iata in same_date_options.
Condition: more than one unique origin_iata AND cost difference > £20
Insight: "Flying from [cheapest_airport] saves £[diff] vs [most_expensive_airport] on these dates."
Include transit route for cheapest airport if outbound_transit_route is available.

4. OUTBOUND ARRIVAL AIRPORT
Find cheapest total_cost_gbp per unique out_dest_iata in same_date_options.
Condition: more than one unique out_dest_iata AND cost difference > £20
Insight: compare airports with actual cost difference.

5. RETURN ARRIVAL AIRPORT
Find cheapest total_cost_gbp per unique ret_dest_iata in same_date_options.
Condition: more than one unique ret_dest_iata AND cost difference > £20

6. SPLIT CARRIER — POSITIVE USP
Find cheapest split_carrier: true AND cheapest split_carrier: false in same_date_options.
Condition: split_carrier: true is cheaper by > £20
Framing: ALWAYS positive — this is a feature, not a warning
"We found a cheaper option by combining two airlines — [outbound_carrier] outbound and [return_carrier] return saves £[diff] vs the cheapest single-airline booking."
If split carrier is NOT cheaper: DO NOT surface this lever

RECOMMENDED COMBINATION LEVERS (use recommended combination fields only):

7. TRAVEL LIGHT — CABIN BAGS
Condition: cabin_bag_cost_gbp > 0 (always surface if true)
Insight: "Your [N] cabin bags add £[cabin_bag_cost_gbp] to this trip. Travelling with personal items only removes this cost entirely."
saving_gbp: cabin_bag_cost_gbp value

8. CHECKED BAGS
Condition: checked_bag_cost_gbp > 0 (always surface if true)
Insight: "Dropping your checked bag saves £[checked_bag_cost_gbp] — worth considering for a [trip_nights]-night city break."
saving_gbp: checked_bag_cost_gbp value

9. TRANSPORT — OUTBOUND
Use: outbound_transit_cost_gbp vs outbound_uber_cost_gbp from recommended combination
Condition: both values exist AND (cost difference > £20 OR time difference > 45 mins)
Insight: state cost difference AND time difference clearly.
"The [transit_route] costs £[transit] vs £[uber] by Uber — saving £[diff], though [transit] takes [transit_mins] mins vs [uber_mins] mins by Uber."

10. TRANSPORT — RETURN
Same pattern as outbound using return transit fields.

11. TRANSIT CHANGES
Condition: outbound_transit_changes >= 2
Insight: "Getting to [origin_iata] involves [N] changes — factor this in when travelling with children and luggage."
This is informational, not a savings lever — saving_gbp: null

STRICT RULES:
- Use ONLY numbers from the data provided — do not calculate, estimate or invent any figure
- Do not say "baseline"
- Do not mention seat selection policy, transit accuracy, pre-booking advice, or generic travel tips
- Maximum 2 caveats: only if baggage_is_estimate: true or family_split_risk: true on recommended combination
- For caveats: baggage_is_estimate → "Bag fees for [carrier] are estimated — actual price may vary by route." family_split_risk → "Seat costs of £[seat_cost_gbp] are included to keep your family together."
- Every verified_field must be an exact field name from the combinations data

Return ONLY this JSON, no other text:
{
  "recommendation_prose": "<string>",
  "lever_insights": [
    {
      "lever": "<inset_day|absence_tradeoff|departure_airport|outbound_arrival_airport|return_arrival_airport|split_carrier|travel_light|checked_bags|transport_outbound|transport_return|transit_changes>",
      "headline": "<5 words max>",
      "insight": "<one sentence, specific, with actual numbers>",
      "saving_gbp": <number|null>,
      "verified_field": "<exact field name>",
      "verified_value": <actual value>
    }
  ],
  "caveats": ["<string>"],
  "confidence": "<high|medium|low>"
}`;

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
    const insightParsed = JSON.parse(cleanInsightText);

    console.log('[getAIRecommendation] lever count:', insightParsed.lever_insights?.length);
    console.log('[getAIRecommendation] prose:', insightParsed.recommendation_prose);

    return {
      recommended_index: recommendedIndex,
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
      recommendation_prose: 'We found the best value option for your dates.',
      lever_insights: [],
      caveats: [],
      confidence,
      fallback: false,
    };
  }
}
