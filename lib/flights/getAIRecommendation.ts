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

2. TRIP NIGHTS — CRITICAL RULE:
   If any combination offers more trip_nights than the cheapest option
   AND the cost difference is less than £25 per extra night — ALWAYS
   prefer the longer trip. This is not a trade-off, it is an automatic win.

   Examples:
   - 4 nights at £703 vs 3 nights at £702 → pick 4 nights (£1 < £25 threshold)
   - 4 nights at £725 vs 3 nights at £702 → pick 4 nights (£23 < £25 threshold)
   - 4 nights at £730 vs 3 nights at £702 → pick 3 nights (£28 > £25 threshold)

   Treat is_inset_day: true as one additional free trip_night.
   A 3-night inset day combination beats a 3-night non-inset at equal cost
   because the family travels without school absence pressure.

3. QUALITY — only apply when trip_nights and cost are equal or within threshold:
   Prefer better arrival_quality and departure_quality.
   CRITICAL: Only treat quality as different if combinations are in
   DIFFERENT quality bands. Do not distinguish within the same band.
   - 'very_early' (before 06:00) vs 'early' (06:00-09:00) = meaningful difference
   - 05:20 vs 05:30 = both 'very_early' = NO difference — treat as identical
   - Never use a time difference under 30 minutes to distinguish combinations
     in the same quality band.

4. TRAVEL TIME: prefer lower total_outbound_travel_mins within £30 of each other.

5. TRANSIT CHANGES: prefer fewer outbound_transit_changes within £30 of each other.

IMPORTANT:
- fine_gbp is already included in total_inc_fine — absence can still be best pick if net saving is significant
- is_inset_day: true is a strong positive — treat as a free extra night
- Do not penalise split_carrier — mixing airlines saves money and is perfectly fine
- When trip_nights and quality bands are identical between two combinations,
  the cheaper one wins — but trip_nights always beats a small cost difference
- The cheapest option is not always the best — but you must clearly justify
  any pick that is not the cheapest

CRITICAL: Return ONLY the JSON object. Do not write any text before or after it.
Do not explain your reasoning outside the JSON. Start your response with { and end with }.

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
    const { data: pickMessage, response: pickRawResponse } = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{ role: 'user', content: pickPrompt }],
    }).withResponse();
    console.log('[getAIRecommendation] pick call ms:', Date.now() - pickStart);
    console.log('[getAIRecommendation] pick response status:', pickRawResponse.status);
    console.log('[getAIRecommendation] pick response cached:', pickRawResponse.headers.get('cf-cache-status'));

    const pickText = pickMessage.content[0]?.type === 'text' ? pickMessage.content[0].text : '';
    // Strip markdown fences and extract JSON object even if model adds preamble
    const cleanPickText = pickText.replace(/```json|```/g, '').trim();
    const pickJsonMatch = cleanPickText.match(/\{[\s\S]*\}/);
    if (!pickJsonMatch) {
      console.error('[getAIRecommendation] No JSON object found in pick response:', cleanPickText.slice(0, 200));
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

  // ── Same-date summaries (replaces raw sameDates array in prompt) ──────────
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
    }, new Map<string, object>()).values()
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
    }, new Map<string, object>()).values()
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
    }, new Map<string, object>()).values()
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

  const insightPrompt = `You are a financial intelligence tool helping a London family save money on their school holiday flight. Generate insights based ONLY on the pre-computed data below. Do not calculate anything yourself — every number is already computed.

RECOMMENDED COMBINATION:
${JSON.stringify(recommended, null, 2)}

WHY THIS WAS PICKED (internal reasoning — use this to write the prose):
${pickingReasoning}

SAME-DATE SUMMARIES (pre-computed — use these numbers directly, do not recalculate):

DEPARTURE AIRPORTS (cheapest per airport, recommended dates):
${JSON.stringify(depAirportSummary, null, 2)}

OUTBOUND ARRIVAL AIRPORTS (cheapest per airport, recommended dates):
${JSON.stringify(outDestSummary, null, 2)}

RETURN ARRIVAL AIRPORTS (cheapest per airport, recommended dates):
${JSON.stringify(retDestSummary, null, 2)}

SPLIT CARRIER vs SINGLE CARRIER (recommended dates):
${JSON.stringify(splitCarrierSummary, null, 2)}

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

Case A — cheapest_inset_is_recommended is TRUE (we picked the inset day):
ALWAYS surface this lever. Frame as what the family gains:
"Departing on [cheapest_inset_outbound_date] — [school_name]'s inset day —
means zero school absence and zero fines.
[If inset_extra_nights > 0: 'You also get [N] extra night(s) vs the next available date for [£X more/the same price].']"
saving_gbp: inset_saving_vs_non_inset (if positive) else null

Case B — cheapest_inset_is_recommended is FALSE (we did not pick the inset day):
Only surface if inset_saving_vs_non_inset > 0 OR inset_extra_nights > 0.
Frame as an alternative: "Alternatively, flying on [date] — the inset day —
[saves £X / costs £X more but gives N extra night(s)]."
If inset is more expensive with no extra nights: DO NOT surface.

2. ABSENCE TRADE-OFF
Use: cross_date_levers.absence_tradeoff
Condition: net_saving_vs_recommended > 20
Framing: neutral, factual
"Flying on [date] costs £[total] including a £[fine] fine for [N] absence day(s) — still £[net_saving] less than the recommended option."
If net saving ≤ £20: DO NOT surface this lever

SAME-DATE LEVERS (use SAME-DATE SUMMARIES above — do not recalculate):

3. DEPARTURE AIRPORT
Use: dep_airport_summary (sorted cheapest first)
Condition: more than one entry AND cost difference between first and last entry > £20
Default insight: "Flying from [cheapest.origin_iata] saves £[diff] vs [most_expensive.origin_iata] on these dates."
Include transit route for cheapest airport if outbound_transit_route is available.
If the recommended combination's origin_iata is already the cheapest airport:
Frame as "we chose the cheapest departure airport":
"[origin_iata] is the cheapest departure option on these dates — [most_expensive.origin_iata] costs £[diff] more."
Do not frame this as a saving the parent needs to act on.

4. OUTBOUND ARRIVAL AIRPORT
Use: out_dest_summary (sorted cheapest first)
Condition: more than one entry AND cost difference > £20
Insight: compare airports with actual cost difference.

5. RETURN ARRIVAL AIRPORT
Use: return_arrival_airports pre-computed summary
Condition: more than one entry in return_arrival_airports AND cost difference between cheapest and most expensive > £20
Insight: "Returning to [cheapest_ret_dest_iata] saves £[diff] vs returning to [most_expensive_ret_dest_iata] on these dates."
The saving is the difference between the cheapest and most expensive ret_dest_iata total_cost_gbp — NOT the total trip cost.
Do not compare against combinations from different dates.

6. SPLIT CARRIER — POSITIVE USP
Use: split_carrier_summary
Condition: saving_gbp > 20 (cheapest split is cheaper than cheapest single by > £20)
Framing: ALWAYS positive — this is a feature, not a warning
"We found a cheaper option by combining two airlines — [cheapest_split.outbound_carrier] outbound and [cheapest_split.return_carrier] return saves £[saving_gbp] vs the cheapest single-airline booking."
If saving_gbp is null or ≤ 20: DO NOT surface this lever

RECOMMENDED COMBINATION LEVERS (use recommended combination fields only):

7. TRAVEL LIGHT — CABIN BAGS
MANDATORY: Always include this lever if cabin_bag_cost_gbp > 0 on the
recommended combination. Do not skip it.
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
For transport_return: if the recommended combination has departure_quality
'very_early', frame the insight around convenience not just cost saving.
If transit involves 2+ changes at an early hour, acknowledge that Uber
may be worth the extra cost despite being more expensive.
In this case: saving_gbp should be null (we are recommending spending more, not less).
Headline should reflect the recommendation, not the cheaper option.
Example: "5:30am return — Uber worth considering" with insight explaining
transit saves £X but Uber avoids [N] changes at that hour.

11. TRANSIT CHANGES
Condition: outbound_transit_changes >= 2 OR return_transit_changes >= 2
BUT: Do NOT surface this lever if transport_outbound or transport_return
insight is already being generated for the same leg — it would be duplicate
information. Only surface transit_changes as a standalone insight if the
transport mode insight for that leg is NOT being shown.
Insight: "Getting to [origin_iata] involves [N] changes — factor this in when travelling with children and luggage."
This is informational, not a savings lever — saving_gbp: null

STRICT RULES:
- Use ONLY numbers from the data provided — do not calculate, estimate or invent any figure
- Do not say "baseline"
- Do not mention seat selection policy, transit accuracy, pre-booking advice, or generic travel tips
- Maximum 1 caveat, only if baggage_is_estimate: true on recommended combination
- Caveat text: "Bag fees for [carrier] are estimated — actual price may vary by route."
- Do not add a caveat about seats — seat costs are already included in the total
- Every verified_field must be an exact field name from the combinations data

CRITICAL: Return ONLY the JSON object. Do not write any text before or after it.
Do not explain your reasoning outside the JSON. Start your response with { and end with }.

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

  console.log('[getAIRecommendation] insight prompt length (chars):', insightPrompt.length);
  try {
    const insightStart = Date.now();
    const insightMessage = await client.messages.create({
      // Insight call — Haiku is sufficient for structured output from pre-computed data
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
      console.error('[getAIRecommendation] No JSON object found in insight response:', cleanInsightText.slice(0, 200));
      return {
        recommended_index: recommendedIndex,
        recommendation_prose: 'We found the best value option for your dates.',
        lever_insights: [],
        caveats: [],
        confidence,
        fallback: false,
      };
    }
    const insightParsed = JSON.parse(insightJsonMatch[0]);

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
