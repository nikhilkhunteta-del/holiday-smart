// Price-movement math — pure, deterministic, zero external dependencies.
// Safe to import from client components (price-history-section.tsx,
// ai-recommendation-client.tsx) as well as server code. The AI narration
// call that turns these facts into prose lives in priceMovementNarration.ts
// instead, specifically because it imports @anthropic-ai/sdk (Node-only
// dependencies — fs/crypto/child_process/path — that break a browser
// bundle). Do NOT import @anthropic-ai/sdk or anything server-only into
// this file; that was the whole reason for the split — see
// priceMovementNarration.ts's header comment for the incident this fixed.
//
// Reused across three call sites: the top-section per-itinerary
// price_movement card (getAIRecommendation.ts / ai-recommendation-client.tsx),
// the destination-level median card, and the per-cell history card (both
// below the date matrix, in price-history-section.tsx). See CLAUDE.md →
// "AI Recommendation Card System".

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
  // Optional to match PriceMovementComputed's optional range fields (which
  // computePriceMovement always populates in practice, but the type allows
  // undefined) — the `== null` checks below treat null and undefined alike.
  range_low_gbp?: number | null;
  range_high_gbp?: number | null;
  price_position?: PricePositionTier | null;
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

const SMALL_NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];

// Threshold below which a raw check count is still the honest, useful
// thing to say (below this, "weekly since [date]" would overstate how
// much history actually exists); at or above it, stating the exact count
// reads oddly (rule 6 in priceMovementNarration.ts) and "weekly since
// [date]" carries the same information without it. Roughly matches the
// "10+ checks" point where count-framing already read oddly (see that
// rule's own comment) — 8 is the rounder, slightly more conservative cut.
const CADENCE_COUNT_THRESHOLD = 8;

// Deterministic (non-AI) description of how often this price has been
// checked — computed here, not left for the LLM to apply a numeric
// threshold itself, since that's exactly the kind of precise rule an LLM
// can flub. Passed into narratePriceMovement as a fact to copy, not a
// number for it to reason about.
export function buildCadenceLabel(checksWithData: number, firstCheckedOn: string | null): string | null {
  if (!firstCheckedOn || checksWithData <= 0) return null;
  const since = formatRangeLineDate(firstCheckedOn);
  if (checksWithData >= CADENCE_COUNT_THRESHOLD) {
    return `weekly since ${since}`;
  }
  const countWord = SMALL_NUMBER_WORDS[checksWithData] ?? String(checksWithData);
  const checkWord = checksWithData === 1 ? 'check' : 'checks';
  return `${countWord} ${checkWord} since ${since}`;
}
