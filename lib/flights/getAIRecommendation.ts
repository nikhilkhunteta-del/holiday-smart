import Anthropic from '@anthropic-ai/sdk';
import type { AssembledCombination, AssembledBaseline } from './assembleRecommendation';

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

interface FamilyContext {
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

function buildPrompt(
  combinations: AssembledCombination[],
  _baseline: AssembledBaseline,
  ctx: FamilyContext,
): string {
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
    outbound_uber_cost_gbp: c.outbound_transit?.uber?.mean_pence
      ? Math.round(c.outbound_transit.uber.mean_pence / 100) : null,
    outbound_uber_duration_mins: c.outbound_transit?.uber?.duration_mins ?? null,
    outbound_early_warning: c.outbound_transit?.transit?.early_flight_warning ?? false,
    return_transit_cost_gbp: c.return_transit_cost_gbp,
    return_transit_route: c.return_transit?.transit?.route_summary ?? null,
    return_uber_cost_gbp: c.return_transit?.uber?.mean_pence
      ? Math.round(c.return_transit.uber.mean_pence / 100) : null,
    return_uber_duration_mins: c.return_transit?.uber?.duration_mins ?? null,
    destination_transfer_cost_gbp: c.destination_transfer_cost_gbp,
    family_split_risk: c.family_split_risk,
    baggage_is_estimate: c.baggage_is_estimate,
    total_cost_gbp: c.total_cost_gbp,
    total_inc_fine: c.total_inc_fine,
  }));

  const prompt = `You are a financial intelligence tool helping a London family save money on their school holiday flights. You have access to every viable flight combination for their trip, fully priced including flights, bags, seats, transport to/from the airport, and any school absence fines.

FAMILY CONTEXT:
- School: ${ctx.schoolName ?? 'unknown'}, ${ctx.borough ?? 'London'} (${ctx.postcodeDistrict})
- Party: ${ctx.adults} adults, ${ctx.children} children${ctx.infants ? `, ${ctx.infants} infants` : ''}
- Half-term window: ${ctx.windowStart} to ${ctx.windowEnd}
- Bags: ${ctx.cabinBags} cabin bags, ${ctx.checkedBags} checked bags
- Seats together: ${ctx.seatsTogether}

ALL COMBINATIONS (${combinations.length} options, all costs in GBP, fully priced for the whole family):
${JSON.stringify(combinationsForPrompt, null, 2)}

YOUR TWO TASKS:

TASK 1 — PICK THE BEST COMBINATION:
Choose the single best combination index. Consider:
- total_inc_fine is the true all-in cost including any absence fine — use this for cost comparisons
- A saving of £5 or less is NOT worth outbound_arrival_time after 21:00 or outbound_departure_time before 06:00 for a family with children
- Strongly prefer is_inset_day: true if total_inc_fine is within £30 of the cheapest option — the family gets an extra holiday day for free
- outbound_arrival_time after 21:00 means the family arrives at the destination late at night with children — avoid unless saving exceeds £50
- return_departure_time before 06:00 is an early start — acceptable but note it
- fine_gbp is already included in total_inc_fine — a combination requiring absence can still be the best pick if the net saving is significant
- family_split_risk: true means a low-cost carrier may not seat the family together without paying — seat_cost_gbp already includes this cost so it is not a hidden extra
- split_carrier: true means outbound and return are on different airlines and must be booked separately — factor in the inconvenience

TASK 2 — FIND SAVINGS LEVERS:
Scan ALL ${combinations.length} combinations and identify where this family could save money or get better value by making different choices. Surface only insights where the saving or trade-off is genuinely meaningful.

Check each lever below. For each one, compare actual values from the data — do not estimate or invent numbers:

1. INSET DAY
Condition: any combination has is_inset_day: true
Find: cheapest total_inc_fine among is_inset_day: true combinations vs cheapest among is_inset_day: false combinations
Insight: what does flying on the inset day save, or what extra day does it give?
Only surface if inset day combinations exist in the data.

2. ABSENCE TRADE-OFF
Condition: any combination has requires_absence: true AND total_inc_fine lower than recommended
Find: cheapest total_inc_fine among requires_absence: true combinations. Subtract from recommended total_inc_fine to get net saving.
Insight: "Flying on [date] costs [total] including a [fine] fine — still [saving] cheaper than the recommended option."
Only surface if net saving after fine exceeds £20.

3. DEPARTURE AIRPORT
Condition: more than one unique origin_iata exists across combinations on the recommended dates
Find: for each unique origin_iata on the recommended outbound_date and return_date, find the cheapest total_cost_gbp
Insight: compare cheapest vs most expensive airport. Mention the transit route if available.
Only surface if cost difference exceeds £20.

4. OUTBOUND ARRIVAL AIRPORT
Condition: more than one unique out_dest_iata exists on the recommended dates
Find: cheapest total_cost_gbp per unique out_dest_iata on recommended dates
Insight: compare airports including destination_transfer_cost_gbp impact.
Only surface if cost difference exceeds £20.

5. RETURN ARRIVAL AIRPORT
Condition: more than one unique ret_dest_iata exists on the recommended dates
Find: cheapest total_cost_gbp per unique ret_dest_iata on recommended dates
Only surface if cost difference exceeds £20.

6. TRAVEL LIGHT — CABIN BAGS
Condition: cabin_bag_cost_gbp > 0 on recommended combination
Find: cheapest total_inc_fine among combinations with cabin_bag_cost_gbp: 0 on any dates
Insight: "Travelling without cabin bags saves £[X] — your all-in cost drops to £[Y]."
Always surface this if cabin_bag_cost_gbp > 0.

7. CHECKED BAGS
Condition: checked_bag_cost_gbp > 0 on recommended combination
Find: cheapest total_inc_fine among combinations with checked_bag_cost_gbp: 0
Insight: state the saving from dropping checked bags.
Always surface this if checked_bag_cost_gbp > 0.

8. TRANSPORT MODE — OUTBOUND
Use outbound_transit_cost_gbp vs outbound_uber_cost_gbp on the recommended combination only.
Insight: state cost difference and time difference (outbound_uber_duration_mins vs outbound_transit_duration_mins).
Only surface if cost difference exceeds £20 OR time difference exceeds 45 minutes.

9. TRANSPORT MODE — RETURN
Use return_transit_cost_gbp vs return_uber_cost_gbp on the recommended combination only.
Same threshold as outbound.

10. SPLIT CARRIER
Condition: both split_carrier: true and split_carrier: false combinations exist on recommended dates
Find: cheapest total_cost_gbp for split_carrier: true vs split_carrier: false on recommended dates
Insight: "Mixing carriers saves £[X] but means two separate bookings — if one flight is delayed the other airline owes you nothing."
Only surface if cost difference exceeds £20.

STRICT RULES — ENFORCED:
- Only use numbers that appear in the combinations data — do not calculate, estimate or invent any figure
- Do not use the word "baseline" — say "a typical family from this school" or "most families booking this route"
- Do not mention seat selection policy, transit timetable accuracy, or generic booking advice
- Do not surface absence as a negative — it is already priced into total_inc_fine
- Maximum 2 caveats, only when baggage_is_estimate: true or family_split_risk: true on the recommended combination
- Every verified_field must be an exact field name from this list:
  index, outbound_date, return_date, origin_iata, out_dest_iata, ret_dest_iata,
  outbound_carrier, return_carrier, split_carrier, outbound_departure_time,
  outbound_arrival_time, outbound_duration_mins, return_departure_time, return_arrival_time,
  is_inset_day, requires_absence, absence_days, fine_gbp, cabin_bag_cost_gbp,
  checked_bag_cost_gbp, seat_cost_gbp, outbound_transit_cost_gbp, outbound_transit_route,
  outbound_transit_duration_mins, outbound_uber_cost_gbp, outbound_uber_duration_mins,
  outbound_early_warning, return_transit_cost_gbp, return_transit_route, return_uber_cost_gbp,
  return_uber_duration_mins, destination_transfer_cost_gbp, family_split_risk,
  baggage_is_estimate, total_cost_gbp, total_inc_fine

Return ONLY this JSON, no other text:
{
  "recommended_index": <number>,
  "recommendation_prose": "<2-3 sentences. Direct and warm. Written to the parent. Reference actual times, costs, dates. Do not say 'baseline'. Explain WHY this combination — what makes it the best trade-off.>",
  "lever_insights": [
    {
      "lever": "<inset_day | absence_tradeoff | departure_airport | outbound_arrival_airport | return_arrival_airport | travel_light | checked_bags | transport_outbound | transport_return | split_carrier | family_split_risk | bags_estimate>",
      "headline": "<5 words max — e.g. 'Fly light, save £94'>",
      "insight": "<one sentence, specific, includes actual numbers from the data>",
      "saving_gbp": <number | null>,
      "verified_field": "<exact field name from the list above>",
      "verified_value": <actual value of that field on the relevant combination>
    }
  ],
  "caveats": ["<string>"],
  "confidence": "<high | medium | low>"
}`;

  console.log('[getAIRecommendation] combinations count:', combinationsForPrompt.length);
  console.log('[getAIRecommendation] prompt length (chars):', prompt.length);
  return prompt;
}

const FALLBACK: AIRecommendationOutput = {
  recommended_index: 0,
  recommendation_prose: 'We recommend the lowest-cost option based on total price including all fees.',
  lever_insights: [],
  caveats: ['AI recommendation unavailable — showing cheapest option.'],
  confidence: 'low',
  fallback: true,
};

export async function getAIRecommendation(
  combinations: AssembledCombination[],
  baseline: AssembledBaseline,
  ctx: FamilyContext,
): Promise<AIRecommendationOutput> {
  console.log('[getAIRecommendation] function entered');
  if (combinations.length === 0) return FALLBACK;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  console.log('[getAIRecommendation] API key status:',
    !apiKey ? 'missing' :
    apiKey === 'your_api_key_here' ? 'placeholder' :
    'present, length: ' + apiKey.length
  );
  if (!apiKey || apiKey === 'your_api_key_here') return FALLBACK;

  try {
    const client = new Anthropic({ apiKey });
    const prompt = buildPrompt(combinations, baseline, ctx);

    const start = Date.now();
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });
    console.log('[getAIRecommendation] response ms:', Date.now() - start);

    const raw = message.content[0]?.type === 'text' ? message.content[0].text : '';
    console.log('[getAIRecommendation] raw AI response:', raw);
    const parsed: AIRecommendationOutput = JSON.parse(raw);

    parsed.recommended_index = Math.max(
      0,
      Math.min(parsed.recommended_index, combinations.length - 1),
    );
    parsed.fallback = false;
    console.log('[getAIRecommendation] recommended_index:', parsed.recommended_index);
    console.log('[getAIRecommendation] lever count:', parsed.lever_insights?.length);
    console.log('[getAIRecommendation] prose:', parsed.recommendation_prose);
    return parsed;
  } catch {
    return FALLBACK;
  }
}
