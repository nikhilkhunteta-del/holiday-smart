/**
 * Price ties — one rule everywhere: when two options cost the same, the earlier departure wins.
 *
 * Several flights can carry exactly the same fare (two Vueling Gatwick flights at £123, say),
 * and every "pick the cheapest" used to keep whichever happened to come first — which depended
 * on database row order, so the page could show a different flight on different visits. Every
 * sort and every cheapest/best pick over combinations goes through `compareCostThenDeparture`
 * (or `earlierDeparture` as its tie-break), and the SQL functions order the same way.
 *
 * Costs are compared to the penny, so float noise (412.0000001 vs 412) never decides a tie.
 * Pure, dependency-free — safe in client components.
 */

export interface DepartureKeyed {
  outbound_date?: string | null;
  outbound_departure_time?: string | null;
  return_date?: string | null;
  return_departure_time?: string | null;
  origin_iata?: string | null;
  out_dest_iata?: string | null;
  ret_orig_iata?: string | null;
  ret_dest_iata?: string | null;
  outbound_carrier?: string | null;
  return_carrier?: string | null;
}

const str = (v: string | null | undefined) => v ?? '';

/** Earlier outbound (date, then time), then earlier return, then a fixed airport/carrier order. */
export function earlierDeparture(a: DepartureKeyed, b: DepartureKeyed): number {
  const keys: (keyof DepartureKeyed)[] = [
    'outbound_date', 'outbound_departure_time', 'return_date', 'return_departure_time',
    'origin_iata', 'out_dest_iata', 'ret_orig_iata', 'ret_dest_iata', 'outbound_carrier', 'return_carrier',
  ];
  for (const k of keys) {
    const c = str(a[k]).localeCompare(str(b[k]));
    if (c !== 0) return c;
  }
  return 0;
}

const pennies = (n: number) => Math.round(n * 100);

/** Comparator: cheaper first (to the penny); on a tie, earlier departure first. */
export function compareCostThenDeparture<T extends DepartureKeyed>(cost: (x: T) => number) {
  return (a: T, b: T): number => (pennies(cost(a)) - pennies(cost(b))) || earlierDeparture(a, b);
}

/** The cheapest item by `cost`, ties going to the earlier departure. Undefined for an empty list. */
export function cheapestBy<T extends DepartureKeyed>(items: readonly T[], cost: (x: T) => number): T | undefined {
  const cmp = compareCostThenDeparture(cost);
  let best: T | undefined;
  for (const x of items) if (best === undefined || cmp(x, best) < 0) best = x;
  return best;
}
