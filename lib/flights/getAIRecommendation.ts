import Anthropic from '@anthropic-ai/sdk';
import type { AssembledCombination, AssembledBaseline } from './assembleRecommendation';

export interface AIRecommendationOutput {
  recommended_index: number;
  recommendation_prose: string;
  lever_insights: Array<{
    lever: string;
    insight: string;
    verified_field: string;
    verified_value: string | number | boolean;
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

function formatCombination(c: AssembledCombination, i: number): string {
  const parts = [
    `[${i}] ${c.outbound_date} → ${c.return_date}`,
    `  Airport: ${c.origin_iata}`,
    `  Carriers: ${c.outbound_carrier}/${c.return_carrier}${c.split_carrier ? ' (split)' : ''}`,
    `  Total (inc fine): £${c.total_inc_fine.toFixed(2)}`,
    `  Fare+ancillary: £${c.fare_plus_ancillary_gbp.toFixed(2)}`,
    `  Transit: £${c.transit_cost_gbp.toFixed(2)}`,
    `  Dest transfer: £${c.destination_transfer_cost_gbp.toFixed(2)}${c.destination_transfer_known ? '' : ' (est)'}`,
    `  Fine: ${c.fine_gbp != null ? `£${c.fine_gbp.toFixed(2)}` : 'none'}`,
    `  Requires absence: ${c.requires_absence} (${c.absence_days}d)`,
    `  Inset day: ${c.is_inset_day}`,
    `  Family split risk: ${c.family_split_risk}`,
    `  Outbound: dep ${c.outbound_departure_time ?? '?'} arr ${c.outbound_arrival_time ?? '?'} (${c.outbound_duration_mins != null ? `${c.outbound_duration_mins}m` : '?'})`,
    `  Return: dep ${c.return_departure_time ?? '?'} arr ${c.return_arrival_time ?? '?'} (${c.return_duration_mins != null ? `${c.return_duration_mins}m` : '?'})`,
    `  Baggage estimate: ${c.baggage_is_estimate}`,
  ];
  return parts.join('\n');
}

function buildPrompt(
  combinations: AssembledCombination[],
  baseline: AssembledBaseline,
  ctx: FamilyContext,
): string {
  const top = Math.min(10, combinations.length);
  const comboText = combinations
    .slice(0, top)
    .map((c, i) => formatCombination(c, i))
    .join('\n\n');

  return `You are a family travel advisor helping London parents book flights during school holidays.

FAMILY:
- School: ${ctx.schoolName ?? 'Unknown'}, ${ctx.borough ?? 'Unknown borough'}
- Postcode district: ${ctx.postcodeDistrict ?? 'Unknown'}
- Party: ${ctx.adults} adult(s), ${ctx.children} child(ren), ${ctx.infants} infant(s)
- Bags: ${ctx.cabinBags} cabin, ${ctx.checkedBags} checked
- Seats together: ${ctx.seatsTogether}
- Holiday window: ${ctx.windowStart} to ${ctx.windowEnd}

BASELINE (school-window flights from nearest airport, no absence):
- Airport: ${baseline.baseline_airport}
- Dates: ${baseline.outbound_date} → ${baseline.return_date}
- Carrier: ${baseline.carrier}
- Total: £${baseline.total_cost_gbp.toFixed(2)}
- Fare+ancillary: £${baseline.fare_plus_ancillary_gbp.toFixed(2)}
- Transit: £${baseline.transit_cost_gbp.toFixed(2)}

TOP ${top} COMBINATIONS (sorted by total cost inc fine, index 0 = cheapest):
${comboText}

Choose the best combination for this family. Prioritise:
1. Total cost (inc fine) — lower is better
2. No unauthorised absence (requires_absence = false) unless saving is substantial (>£100)
3. Inset day departures preferred when cost-neutral (within £20)
4. Family split risk (family_split_risk = true) is a strong negative signal
5. Reasonable departure times (not before 06:00)

Respond ONLY with valid JSON matching this exact schema — no markdown, no prose outside the JSON:
{
  "recommended_index": <integer 0-${top - 1}>,
  "recommendation_prose": "<2–3 sentence plain-English explanation for the parent>",
  "lever_insights": [
    {
      "lever": "<short label>",
      "insight": "<one sentence>",
      "verified_field": "<field name from combination>",
      "verified_value": <actual value from the chosen combination>
    }
  ],
  "caveats": ["<string>"],
  "confidence": "high" | "medium" | "low",
  "fallback": false
}`;
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
  if (combinations.length === 0) return FALLBACK;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your_api_key_here') return FALLBACK;

  try {
    const client = new Anthropic({ apiKey });
    const prompt = buildPrompt(combinations, baseline, ctx);

    const message = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = message.content[0]?.type === 'text' ? message.content[0].text : '';
    const parsed: AIRecommendationOutput = JSON.parse(raw);

    // Clamp index to valid range
    parsed.recommended_index = Math.max(
      0,
      Math.min(parsed.recommended_index, combinations.length - 1),
    );
    parsed.fallback = false;
    return parsed;
  } catch {
    return FALLBACK;
  }
}
