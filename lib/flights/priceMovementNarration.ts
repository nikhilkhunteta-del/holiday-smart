// Server-only. Imports @anthropic-ai/sdk, which pulls in Node built-ins
// (node:fs, node:crypto, node:child_process, node:path) that break a
// browser bundle if this file — or anything that imports it — ends up in
// a client component's dependency graph. This is split out from
// priceMovement.ts (pure computation, safe for client import) specifically
// because of a Vercel build failure: price-history-section.tsx and
// ai-recommendation-client.tsx both started doing a plain VALUE import from
// priceMovement.ts (for computePriceMovement/buildPriceRangeLine, to render
// the deterministic range line client-side) when it still had `import
// Anthropic from '@anthropic-ai/sdk'` at the top — webpack then tried to
// bundle the SDK into the client, which fails, since importing any export
// from a module pulls in that module's own top-level imports regardless of
// which export is actually used. Only ever import this file from API
// routes or other server-only code (never from a 'use client' component).
import Anthropic from '@anthropic-ai/sdk';
import type { PriceMovementRaw, PriceMovementComputed } from './priceMovement';

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
