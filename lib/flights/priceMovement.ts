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

export type PricePositionTier = 'low' | 'mid' | 'high';

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
  // Whether the latest price is the lowest ever seen in this series. Kept
  // for backwards compatibility with existing callers; the card's actual
  // closing line is now built deterministically from range_low_gbp /
  // range_high_gbp / price_position below, not from an AI claim about this.
  is_current_lowest: boolean;
  // Deterministic (non-AI) summary of the observed price range — this is
  // what the card's unconditional closing line is built from (see
  // buildPriceRangeLine below), specifically so that line has the same
  // structure and weight whether the news is favourable or not. null when
  // there are fewer than 2 points (nothing to range yet). Optional (not
  // required on every PriceMovementComputed value) because narratePriceMovement
  // never reads these — only computePriceMovement's callers that render the
  // closing line need them populated.
  range_low_gbp?: number | null;
  range_high_gbp?: number | null;
  price_position?: PricePositionTier | null;
}

const FLAT_THRESHOLD_GBP = 5;

export function computePriceMovement(raw: PriceMovementRaw): PriceMovementComputed {
  const points = raw.price_points;

  if (points.length === 0) {
    return {
      latest_total_gbp: null, previous_total_gbp: null, delta_gbp: null, direction: 'no_data',
      first_checked_on: null, first_total_gbp: null, total_change_gbp: null, is_current_lowest: false,
      range_low_gbp: null, range_high_gbp: null, price_position: null,
    };
  }

  const totals = points.map(p => Math.round(p.total_gbp));
  const latest = totals[totals.length - 1];
  const first = totals[0];
  const firstCheckedOn = points[0].checked_on;
  const rangeLow = Math.min(...totals);
  const rangeHigh = Math.max(...totals);
  const isCurrentLowest = latest === rangeLow;

  if (points.length === 1) {
    return {
      latest_total_gbp: latest, previous_total_gbp: null, delta_gbp: null, direction: 'single_point',
      first_checked_on: firstCheckedOn, first_total_gbp: first, total_change_gbp: null,
      is_current_lowest: isCurrentLowest,
      range_low_gbp: null, range_high_gbp: null, price_position: null,
    };
  }

  const previous = totals[totals.length - 2];
  const delta = latest - previous;
  const direction: PriceMovementDirection =
    Math.abs(delta) <= FLAT_THRESHOLD_GBP ? 'flat' : delta > 0 ? 'up' : 'down';
  const totalChange = latest - first;
  const pricePosition: PricePositionTier =
    latest <= rangeLow ? 'low' : latest >= rangeHigh ? 'high' : 'mid';

  return {
    latest_total_gbp: latest, previous_total_gbp: previous, delta_gbp: delta, direction,
    first_checked_on: firstCheckedOn, first_total_gbp: first, total_change_gbp: totalChange,
    is_current_lowest: isCurrentLowest,
    range_low_gbp: rangeLow, range_high_gbp: rangeHigh, price_position: pricePosition,
  };
}

const RANGE_LINE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatRangeLineDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return `${d.getDate()} ${RANGE_LINE_MONTHS[d.getMonth()]}`;
}

export interface PriceRangeFacts {
  direction: PriceMovementDirection;
  latest_total_gbp: number | null;
  first_checked_on: string | null;
  range_low_gbp: number | null;
  range_high_gbp: number | null;
  price_position: PricePositionTier | null;
}

// Deterministic, unconditional closing line for a price-history card — NOT
// AI-generated. Renders with identical structure and weight regardless of
// whether the current price happens to be the low, the high, or neither,
// so the card can never be accused of only concluding something when the
// news is favourable. See CLAUDE.md → "AI Recommendation Card System" for
// the incident this replaced (a conditional "never been cheaper" takeaway
// that only ever appeared in the series-low case).
export function buildPriceRangeLine(facts: PriceRangeFacts): string | null {
  if (facts.latest_total_gbp == null || facts.first_checked_on == null) return null;
  const since = formatRangeLineDate(facts.first_checked_on);

  if (facts.direction === 'single_point') {
    return `Today's £${facts.latest_total_gbp} is the only price we've recorded so far — we began checking on ${since}.`;
  }
  if (facts.range_low_gbp == null || facts.range_high_gbp == null || facts.price_position == null) {
    return null;
  }
  const { range_low_gbp: low, range_high_gbp: high, price_position: position, latest_total_gbp: latest } = facts;

  if (position === 'low') {
    return `Today's £${latest} is the lowest we've recorded since we began checking on ${since} (range £${low}–£${high}).`;
  }
  if (position === 'high') {
    return `Today's £${latest} is the highest we've recorded since ${since} (range £${low}–£${high}).`;
  }
  return `Today's £${latest} sits in the middle of the range we've recorded since ${since} (£${low}–£${high}).`;
}

// Flat, standing disclaimer — hardcoded, never AI-generated, always
// rendered beneath a price-history card regardless of what the data shows.
export const PRICE_MOVEMENT_STANDING_LINE = "We don't predict where prices go next.";

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
time, including the date and price of the first check and the latest one,
plus a field called subject_label telling you exactly what phrase to use
for the thing being tracked (e.g. "this exact flight" or "these exact
dates"). Your only job is to turn those facts into ONE sentence (two only
if truly needed for clarity). Never a paragraph.

Hard rules — violating any of these is a failure:
1. Refer to the thing being tracked using EXACTLY the phrase given in
   subject_label, every time you refer to it — never substitute a
   different phrase (e.g. never say "this flight" or "this combination" if
   subject_label says "these exact dates", and vice versa). This is not a
   stylistic choice: different cards on this page track different things —
   one continuous flight (same carrier throughout its history) versus
   whichever was cheapest for a date pair (which can be a different
   carrier or airport at each check) — and using the wrong phrase would
   misrepresent what the data means.
2. Past tense only. Describe what has already happened. Never predict,
   forecast, or imply what will happen to the price next.
3. Never suggest urgency or create pressure to act now ("don't wait",
   "act fast", "prices are likely to rise", "book before..."). If the data
   shows a price increase, simply state the fact — do not add a call to
   action around it.
4. Do not restate the specific route, airline, or dates behind subject_label
   — that's already shown elsewhere on the page. Only talk about the price
   and how it's moved.
5. Do not invent a number, date, or comparison that wasn't given to you.
6. Never frame the number of checks/observations as the interesting fact
   (never write "across three checks", "in the 4 checks we've made", or
   similar — this reads oddly once there are 10+ checks, and the count
   isn't actually the meaningful part). Anchor instead on the date range
   and the size of the price change, using first_checked_on,
   first_total_gbp, latest_total_gbp, and total_change_gbp — e.g. "Since
   we started tracking this route in late May, the price has fallen from
   £268 to £157 — a drop of £111."
7. If checks_with_data is less than checks_total, still acknowledge the
   gap plainly, but do it by referencing the specific date range you do
   have data for (per rule 6) rather than a raw check count — don't imply
   more history exists than actually does.
8. If direction is 'single_point', do not describe any movement — say
   plainly that this is the first time subject_label has been priced, and
   that there's nothing to compare it to yet.
9. If direction is 'no_data', say plainly that subject_label hasn't been
   found in a previous check, without speculating why.
10. If direction is 'flat', don't force a story — it's fine and honest to
    say the price has barely moved. Do NOT describe this as the price
    having "held steady", "stabilised", "settled", or "levelled off" — with
    only a handful of historical checks (often just two or three), that
    phrasing implies an established pattern the data doesn't support, and
    reads as an implicit forecast that the trend will continue, which rule
    2 already forbids. State only the specific change (or lack of one)
    between the two most recent checks.
11. Never write anything to the effect of "it's never been cheaper than it
    is right now", "it's never been lower", or any other claim that frames
    the current price against the historical low or high point of the
    series. A separate, deterministic line (not written by you) already
    states the price's exact position within the observed range every
    single time — favourable or not — so your sentence must not pre-empt,
    duplicate, or editorialise on that comparison in either direction.
    Describe only the trajectory (what changed, since when, by how much).
12. Output plain text only. No markdown, no quotes around the sentence, no
    preamble like "Here's the insight:".

Return ONLY the sentence(s) — nothing else.`;

export async function narratePriceMovement(
  input: PriceMovementRaw & PriceMovementComputed,
  // Default preserves the top-section per-itinerary card's existing
  // behaviour untouched — it tracks one continuous flight, so "this exact
  // flight" is correct there. The below-matrix cards (destination median,
  // per-cell cheapest-for-these-dates) pass 'these exact dates' instead,
  // since their series can span different carriers/airports at each check.
  subjectLabel: string = 'this exact flight',
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
          subject_label:      subjectLabel,
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
