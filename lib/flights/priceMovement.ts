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
  // First point in the series — lets narration anchor on "since we started
  // tracking this on {date}, price moved from £X to £Y" instead of leaning
  // on a raw check count (which reads oddly once there are 10+ checks).
  first_checked_on: string | null;
  first_total_gbp: number | null;
  total_change_gbp: number | null; // latest - first (signed); null if < 2 points
  // Whether the latest price is the lowest ever seen in this series — the
  // precise, sufficient condition for an honest "it's never been cheaper
  // than it is right now" claim. Deliberately not "monotonically
  // decreasing throughout" — a mid-series bump that still ends at the
  // series minimum doesn't make that claim false.
  is_current_lowest: boolean;
}

const FLAT_THRESHOLD_GBP = 5;

export function computePriceMovement(raw: PriceMovementRaw): PriceMovementComputed {
  const points = raw.price_points;

  if (points.length === 0) {
    return {
      latest_total_gbp: null, previous_total_gbp: null, delta_gbp: null, direction: 'no_data',
      first_checked_on: null, first_total_gbp: null, total_change_gbp: null, is_current_lowest: false,
    };
  }

  const latest = Math.round(points[points.length - 1].total_gbp);
  const first = Math.round(points[0].total_gbp);
  const firstCheckedOn = points[0].checked_on;
  const isCurrentLowest = latest === Math.min(...points.map(p => Math.round(p.total_gbp)));

  if (points.length === 1) {
    return {
      latest_total_gbp: latest, previous_total_gbp: null, delta_gbp: null, direction: 'single_point',
      first_checked_on: firstCheckedOn, first_total_gbp: first, total_change_gbp: null,
      is_current_lowest: isCurrentLowest,
    };
  }

  const previous = Math.round(points[points.length - 2].total_gbp);
  const delta = latest - previous;
  const direction: PriceMovementDirection =
    Math.abs(delta) <= FLAT_THRESHOLD_GBP ? 'flat' : delta > 0 ? 'up' : 'down';
  const totalChange = latest - first;

  return {
    latest_total_gbp: latest, previous_total_gbp: previous, delta_gbp: delta, direction,
    first_checked_on: firstCheckedOn, first_total_gbp: first, total_change_gbp: totalChange,
    is_current_lowest: isCurrentLowest,
  };
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

You will be given pre-computed facts about how this price has moved over
time, including the date and price of the first check and the latest one.
Your only job is to turn those facts into ONE sentence (two only if truly
needed for clarity). Never a paragraph.

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
5. Never frame the number of checks/observations as the interesting fact
   (never write "across three checks", "in the 4 checks we've made", or
   similar — this reads oddly once there are 10+ checks, and the count
   isn't actually the meaningful part). Anchor instead on the date range
   and the size of the price change, using first_checked_on,
   first_total_gbp, latest_total_gbp, and total_change_gbp — e.g. "Since
   we started tracking this route in late May, the price has fallen from
   £268 to £157 — a drop of £111."
6. If checks_with_data is less than checks_total, still acknowledge the
   gap plainly, but do it by referencing the specific date range you do
   have data for (per rule 5) rather than a raw check count — don't imply
   more history exists than actually does.
7. If direction is 'single_point', do not describe any movement — say
   plainly that this is the first time this exact flight has been priced,
   and that there's nothing to compare it to yet.
8. If direction is 'no_data', say plainly that this flight hasn't been
   found in a previous check, without speculating why.
9. If direction is 'flat', don't force a story — it's fine and honest to
   say the price has barely moved.
10. Output plain text only. No markdown, no quotes around the sentence, no
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
          first_checked_on:   input.first_checked_on,
          first_total_gbp:    input.first_total_gbp,
          total_change_gbp:   input.total_change_gbp,
        }),
      }],
    });
    return message.content[0]?.type === 'text' ? message.content[0].text.trim() : '';
  } catch (err) {
    console.error('[narratePriceMovement] call error:', err);
    return '';
  }
}
