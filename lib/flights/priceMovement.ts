// Price-movement math (pure, deterministic) plus the shared narration call
// that turns those facts into copy. Both are reused across three call
// sites: the top-section per-itinerary price_movement card
// (getAIRecommendation.ts), the destination-level median card, and the
// per-cell history card (both below the date matrix) — one prompt, one
// hard-rules set, shared instead of duplicated. See CLAUDE.md → "AI
// Recommendation Card System".

import Anthropic from '@anthropic-ai/sdk';

export interface PricePoint {
  checked_on: string; // date, oldest to newest
  total_gbp: number;
}

export interface PriceMovementRaw {
  checks_total: number;      // how many valid history runs exist overall
  checks_with_data: number;  // how many of those had both legs for this itinerary
  price_points: PricePoint[];
}

export type PriceMovementDirection = 'up' | 'down' | 'flat' | 'single_point' | 'no_data';

export interface PriceMovementComputed {
  latest_total_gbp: number | null;
  previous_total_gbp: number | null;
  delta_gbp: number | null;
  direction: PriceMovementDirection;
}

const FLAT_THRESHOLD_GBP = 5;

export function computePriceMovement(raw: PriceMovementRaw): PriceMovementComputed {
  const points = raw.price_points;

  if (points.length === 0) {
    return { latest_total_gbp: null, previous_total_gbp: null, delta_gbp: null, direction: 'no_data' };
  }

  const latest = Math.round(points[points.length - 1].total_gbp);

  if (points.length === 1) {
    return { latest_total_gbp: latest, previous_total_gbp: null, delta_gbp: null, direction: 'single_point' };
  }

  const previous = Math.round(points[points.length - 2].total_gbp);
  const delta = latest - previous;
  const direction: PriceMovementDirection =
    Math.abs(delta) <= FLAT_THRESHOLD_GBP ? 'flat' : delta > 0 ? 'up' : 'down';

  return { latest_total_gbp: latest, previous_total_gbp: previous, delta_gbp: delta, direction };
}

// ── Shared narration call ───────────────────────────────────────────────────
// A genuine generation call (not the verbatim-copy "voice" mechanism the
// other AI recommendation cards use), so it's a separate, small
// client.messages.create() — same prompt, same hard rules, wherever a price
// history is being narrated.
export const PRICE_MOVEMENT_SYSTEM_PROMPT = `You are writing one short insight line for a flight-price tracking card on a
family holiday planning tool called Holiday Smart. The card sits in a column
of similar cards (e.g. "Why this over the alternatives", "The one trade-off
that matters most") — match their tone: plain, factual, warm but not chatty,
like a knowledgeable friend reporting what they've observed. No marketing
voice, no urgency, no exclamation points.

You will be given pre-computed facts about how many times we've checked this
exact flight itinerary's price, and how it has moved. Your only job is to
turn those facts into ONE sentence (two only if truly needed for clarity).
Never a paragraph.

Hard rules — violating any of these is a failure:
1. Past tense only. Describe what has already happened. Never predict,
   forecast, or imply what will happen to the price next.
2. Never suggest urgency or create pressure to act now ("don't wait",
   "act fast", "prices are likely to rise", "book before..."). If the data
   shows a price increase, simply state the fact — do not add a call to
   action around it.
3. Do not restate the itinerary's route, airline, or dates — that's already
   shown elsewhere on the page. Only talk about the price and how it's moved.
4. Do not invent a number, date, or comparison that wasn't given to you.
5. If checks_with_data is less than checks_total, acknowledge the gap
   plainly (e.g. "in the 2 checks we've been able to price this exact
   flight" or similar) — don't imply more history exists than actually does.
6. If direction is 'single_point', do not describe any movement — say
   plainly that this is the first time this exact flight has been priced,
   and that there's nothing to compare it to yet.
7. If direction is 'no_data', say plainly that this flight hasn't been
   found in a previous check, without speculating why.
8. If direction is 'flat', don't force a story — it's fine and honest to
   say the price has barely moved.
9. Output plain text only. No markdown, no quotes around the sentence, no
   preamble like "Here's the insight:".

Return ONLY the sentence(s) — nothing else.`;

export async function narratePriceMovement(
  input: PriceMovementRaw & PriceMovementComputed,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your_api_key_here') return '';

  const client = new Anthropic({ apiKey });

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      system: PRICE_MOVEMENT_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: JSON.stringify({
          checks_total:       input.checks_total,
          checks_with_data:   input.checks_with_data,
          price_points:       input.price_points,
          latest_total_gbp:   input.latest_total_gbp,
          previous_total_gbp: input.previous_total_gbp,
          delta_gbp:          input.delta_gbp,
          direction:          input.direction,
        }),
      }],
    });
    return message.content[0]?.type === 'text' ? message.content[0].text.trim() : '';
  } catch (err) {
    console.error('[narratePriceMovement] call error:', err);
    return '';
  }
}
