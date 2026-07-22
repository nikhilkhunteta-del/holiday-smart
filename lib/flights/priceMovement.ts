// Pure, deterministic price-movement math — no AI, no network calls.
// Consumes the ordered price-point list returned by the get_price_movement
// RPC and derives latest/previous/delta/direction. See CLAUDE.md → "AI
// Recommendation Card System" for how this feeds the price_movement card.

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
