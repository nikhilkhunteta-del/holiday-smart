import { getTransitCost, type AirportTransitCost } from './transitCost';
import { getAIRecommendation, type AIRecommendationOutput } from './getAIRecommendation';
import { buildCandidateShortlist, combinationKey, computeBenchmark, computeCostRange, computeQualityFields, scoreAndDedupeCombinations, withWinnerIncluded, type ScoredCombination, type CostRange } from './buildCandidates';
import { NIGHT_VALUE, ARRIVAL_PENALTY, OUT_DEP_PENALTY, RET_DEP_PENALTY, DEST_TRANSFER_PENALTY, LONDON_TRANSIT_PENALTY, effectiveCost, selectCombination, type SelectionContext } from './selectCombination';
import { supabaseServer as supabase } from '@/lib/supabase-server';

// mapCombination and the pre-map-keys log below fire once per combination,
// and assembleCombinationsOnly runs ~5x per /api/recommend request (main +
// scenario re-assemblies) — easily hundreds of lines per request. Gated
// behind an explicit env var, off by default, so they don't crowd out other
// per-request logging (e.g. the price-movement debug lines) in log viewers
// that truncate high-volume output. Set DEBUG_ASSEMBLY_LOGS=true to re-enable.
const DEBUG_ASSEMBLY_LOGS = process.env.DEBUG_ASSEMBLY_LOGS === 'true';

// ── Output types ──────────────────────────────────────────────────────────────

export type AssembledCombination = {
  outbound_date: string;
  return_date: string;
  origin_iata: string;
  out_dest_iata: string;
  ret_dest_iata: string;
  outbound_carrier: string;
  return_carrier: string;
  split_carrier: boolean;
  outbound_fare_gbp: number;
  return_fare_gbp: number;
  // Combined bag/seat costs (existing — unchanged)
  cabin_bag_cost_gbp: number;
  checked_bag_cost_gbp: number;
  seat_cost_gbp: number;
  fare_plus_ancillary_gbp: number;
  // Per-leg bag/seat costs (new — from SQL v2)
  outbound_cabin_bag_cost_gbp: number;
  return_cabin_bag_cost_gbp: number;
  outbound_checked_bag_cost_gbp: number;
  return_checked_bag_cost_gbp: number;
  outbound_seat_cost_gbp: number;
  return_seat_cost_gbp: number;
  outbound_ancillary_gbp: number;
  return_ancillary_gbp: number;
  // Bag cost ranges (new — from SQL v2, null when min === max)
  cabin_bag_cost_min_gbp: number;
  cabin_bag_cost_max_gbp: number;
  checked_bag_cost_min_gbp: number;
  checked_bag_cost_max_gbp: number;
  destination_transfer_cost_gbp: number;
  destination_transfer_known: boolean;
  destination_transfer_is_taxi: boolean;
  destination_transit_duration_mins: number | null;
  destination_transit_changes:       number | null;
  destination_taxi_duration_mins:    number | null;
  destination_taxi_cost_gbp:         number | null;
  destination_transit_notes:         string | null;
  destination_taxi_cost_low_gbp:     number | null;
  destination_taxi_cost_high_gbp:    number | null;
  requires_absence: boolean;
  absence_days: number;
  absence_out_days: number; // departure before the window opens
  absence_ret_days: number; // return after the window closes
  fine_gbp: number | null;
  outbound_departure_time: string | null;
  outbound_arrival_time: string | null;
  outbound_duration_mins: number | null;
  return_departure_time: string | null;
  return_arrival_time: string | null;
  return_duration_mins: number | null;
  is_inset_day: boolean;
  baggage_is_estimate: boolean;
  family_split_risk: boolean;
  split_risk_carriers: string[] | null;
  outbound_seating_notes: string | null;
  return_seating_notes: string | null;
  // Transit-enriched fields (added in TypeScript)
  outbound_transit_cost_gbp: number;
  return_transit_cost_gbp: number;
  transit_cost_gbp: number;
  total_cost_gbp: number;
  total_inc_fine: number;
  outbound_transit: AirportTransitCost;
  return_transit: AirportTransitCost;
};

export type AssembledBaseline = {
  outbound_date: string;
  return_date: string;
  origin_iata: string;
  destination_iata: string;
  carrier: string;
  baseline_fare_gbp: number;
  cabin_bag_cost_gbp: number;
  checked_bag_cost_gbp: number;
  seat_cost_gbp: number;
  fare_plus_ancillary_gbp: number;
  destination_transfer_cost_gbp: number;
  destination_transfer_known: boolean;
  destination_transfer_is_taxi: boolean;
  destination_transit_duration_mins: number | null;
  destination_transit_changes:       number | null;
  destination_taxi_duration_mins:    number | null;
  destination_taxi_cost_gbp:         number | null;
  destination_transit_notes:         string | null;
  destination_taxi_cost_low_gbp:     number | null;
  destination_taxi_cost_high_gbp:    number | null;
  outbound_departure_time: string | null;
  outbound_departure_time_parsed: string; // HH:MM
  return_departure_time_assumed:  string; // HH:MM
  baseline_is_fallback: boolean;
  baseline_airport: string;
  family_seating_notes: string | null;
  trip_nights:                    number;
  eff_cost:                       number;
  outbound_dep_quality:           string;
  return_departure_time_derived:  string;
  // Transit-enriched fields
  outbound_transit_cost_gbp: number;
  return_transit_cost_gbp: number;
  transit_cost_gbp: number;
  total_cost_gbp: number;
  outbound_transit: AirportTransitCost | null;
  return_transit: AirportTransitCost | null;
};

// Baseline normalised into the same shape as a combination, so effectiveCost()
// can run on it directly instead of duplicating the penalty formula. Carries
// is_baseline: true so callers can tell it apart, but it is NOT folded into the
// scored combination pool yet — that's a deliberate follow-up, not done here.
export type BaselineAsCombination = AssembledCombination & { is_baseline: true };

// ── Transit cache key ─────────────────────────────────────────────────────────

function cacheKey(airport: string, dateStr: string, timeStr: string): string {
  return `${airport}:${dateStr}:${timeStr}`;
}

function parseDepartureDate(dateStr: string, timeStr: string | null | undefined): Date {
  const time = timeStr ?? '09:00';
  const timePart = time.includes('T') ? time.split('T')[1].slice(0, 5) : time.slice(0, 5);
  return new Date(`${dateStr}T${timePart}:00`);
}

// ── Shared combination mapper ─────────────────────────────────────────────────
// Maps raw SQL combination + transit data into AssembledCombination.
// Used by both assembleCombinationsOnly and assembleRecommendation.

function mapCombination(
  c: any,
  outTransit: AirportTransitCost,
  retTransit: AirportTransitCost,
): AssembledCombination {
  if (DEBUG_ASSEMBLY_LOGS) {
    console.log('[mapCombination] dest transfer raw fields:', {
      destination_transit_notes: c.destination_transit_notes,
      destination_transfer_is_taxi: c.destination_transfer_is_taxi,
      destination_taxi_cost_low_gbp: c.destination_taxi_cost_low_gbp,
      destination_taxi_cost_high_gbp: c.destination_taxi_cost_high_gbp,
      outbound_date: c.outbound_date,
    });
  }
  const outTransitGbp = outTransit.recommended_cost_pence / 100;
  const retTransitGbp = retTransit.recommended_cost_pence / 100;
  const transitCostGbp = outTransitGbp + retTransitGbp;
  const totalCostGbp =
    (c.fare_plus_ancillary_gbp ?? 0) + transitCostGbp + (c.destination_transfer_cost_gbp ?? 0);
  const totalIncFine = totalCostGbp + (c.fine_gbp ?? 0);

  return {
    outbound_date: c.outbound_date,
    return_date: c.return_date,
    origin_iata: c.origin_iata,
    out_dest_iata: c.out_dest_iata,
    ret_dest_iata: c.ret_dest_iata,
    outbound_carrier: c.outbound_carrier,
    return_carrier: c.return_carrier,
    split_carrier: c.split_carrier,
    outbound_fare_gbp: c.outbound_fare_gbp,
    return_fare_gbp: c.return_fare_gbp,
    // Combined (existing)
    cabin_bag_cost_gbp: c.cabin_bag_cost_gbp,
    checked_bag_cost_gbp: c.checked_bag_cost_gbp,
    seat_cost_gbp: c.seat_cost_gbp,
    fare_plus_ancillary_gbp: c.fare_plus_ancillary_gbp,
    // Per-leg (new from SQL v2 — fall back to 0 if old SQL)
    outbound_cabin_bag_cost_gbp: c.outbound_cabin_bag_cost_gbp ?? 0,
    return_cabin_bag_cost_gbp: c.return_cabin_bag_cost_gbp ?? 0,
    outbound_checked_bag_cost_gbp: c.outbound_checked_bag_cost_gbp ?? 0,
    return_checked_bag_cost_gbp: c.return_checked_bag_cost_gbp ?? 0,
    outbound_seat_cost_gbp: c.outbound_seat_cost_gbp ?? 0,
    return_seat_cost_gbp: c.return_seat_cost_gbp ?? 0,
    outbound_ancillary_gbp: c.outbound_ancillary_gbp ?? 0,
    return_ancillary_gbp: c.return_ancillary_gbp ?? 0,
    // Ranges (new from SQL v2 — fall back to point estimate)
    cabin_bag_cost_min_gbp: c.cabin_bag_cost_min_gbp ?? c.cabin_bag_cost_gbp,
    cabin_bag_cost_max_gbp: c.cabin_bag_cost_max_gbp ?? c.cabin_bag_cost_gbp,
    checked_bag_cost_min_gbp: c.checked_bag_cost_min_gbp ?? c.checked_bag_cost_gbp,
    checked_bag_cost_max_gbp: c.checked_bag_cost_max_gbp ?? c.checked_bag_cost_gbp,
    destination_transfer_cost_gbp: c.destination_transfer_cost_gbp,
    destination_transfer_known: c.destination_transfer_known,
    destination_transfer_is_taxi: c.destination_transfer_is_taxi ?? false,
    destination_transit_duration_mins: c.destination_transit_duration_mins ?? null,
    destination_transit_changes:       c.destination_transit_changes ?? null,
    destination_taxi_duration_mins:    c.destination_taxi_duration_mins ?? null,
    destination_taxi_cost_gbp:         c.destination_taxi_cost_gbp ?? null,
    destination_transit_notes:         c.destination_transit_notes ?? null,
    destination_taxi_cost_low_gbp:     c.destination_taxi_cost_low_gbp ?? null,
    destination_taxi_cost_high_gbp:    c.destination_taxi_cost_high_gbp ?? null,
    requires_absence: c.requires_absence,
    absence_days: c.absence_days,
    absence_out_days: c.absence_out_days ?? 0,
    absence_ret_days: c.absence_ret_days ?? 0,
    fine_gbp: c.fine_gbp,
    outbound_departure_time: c.outbound_departure_time,
    outbound_arrival_time: c.outbound_arrival_time,
    outbound_duration_mins: c.outbound_duration_mins,
    return_departure_time: c.return_departure_time,
    return_arrival_time: c.return_arrival_time,
    return_duration_mins: c.return_duration_mins,
    is_inset_day: c.is_inset_day,
    baggage_is_estimate: c.baggage_is_estimate,
    family_split_risk: c.family_split_risk,
    split_risk_carriers: c.split_risk_carriers,
    outbound_seating_notes: c.outbound_seating_notes ?? null,
    return_seating_notes: c.return_seating_notes ?? null,
    outbound_transit_cost_gbp: outTransitGbp,
    return_transit_cost_gbp: retTransitGbp,
    transit_cost_gbp: transitCostGbp,
    total_cost_gbp: totalCostGbp,
    total_inc_fine: totalIncFine,
    outbound_transit: outTransit,
    return_transit: retTransit,
  };
}

// ── Bag cost recalculation ────────────────────────────────────────────────────
// Adjusts cabin/checked bag costs on assembled combinations using per-carrier
// unit fees from airline_baggage_fees, then cascades to fare_plus_ancillary and
// total_cost_gbp. Used by bag scenarios (travel_light, add_checked_bag) so the
// winner selection runs on correct costs rather than SQL-baked originals.

function recalcBagCosts(
  c: AssembledCombination,
  cabinBags: number,
  checkedBags: number,
  bagFees: Map<string, BagFeeRow>,
): AssembledCombination {
  const outFee = bagFees.get(c.outbound_carrier);
  const retFee = bagFees.get(c.return_carrier);

  const outCabin = (outFee && !outFee.cabin_bag_included && cabinBags > 0)
    ? cabinBags * (outFee.full_cabin_bag_fee_gbp ?? 0) : 0;
  const retCabin = (retFee && !retFee.cabin_bag_included && cabinBags > 0)
    ? cabinBags * (retFee.full_cabin_bag_fee_gbp ?? 0) : 0;
  const outChecked = checkedBags > 0
    ? checkedBags * (outFee?.first_checked_bag_gbp ?? 0) : 0;
  const retChecked = checkedBags > 0
    ? checkedBags * (retFee?.first_checked_bag_gbp ?? 0) : 0;

  const newCabinTotal   = outCabin + retCabin;
  const newCheckedTotal = outChecked + retChecked;
  const oldBagTotal     = c.cabin_bag_cost_gbp + c.checked_bag_cost_gbp;
  const newBagTotal     = newCabinTotal + newCheckedTotal;
  const bagDelta        = newBagTotal - oldBagTotal;

  const newFarePlusAnc = c.fare_plus_ancillary_gbp + bagDelta;
  const newTotalCost   = c.total_cost_gbp + bagDelta;
  const newTotalInc    = newTotalCost + (c.fine_gbp ?? 0);

  return {
    ...c,
    cabin_bag_cost_gbp:             newCabinTotal,
    checked_bag_cost_gbp:           newCheckedTotal,
    outbound_cabin_bag_cost_gbp:    outCabin,
    return_cabin_bag_cost_gbp:      retCabin,
    outbound_checked_bag_cost_gbp:  outChecked,
    return_checked_bag_cost_gbp:    retChecked,
    cabin_bag_cost_min_gbp:         newCabinTotal,
    cabin_bag_cost_max_gbp:         newCabinTotal,
    checked_bag_cost_min_gbp:       newCheckedTotal,
    checked_bag_cost_max_gbp:       newCheckedTotal,
    fare_plus_ancillary_gbp:        newFarePlusAnc,
    total_cost_gbp:                 newTotalCost,
    total_inc_fine:                  newTotalInc,
  };
}

// ── Destination transfer flip ─────────────────────────────────────────────────
// When transitPreference is 'uber', substitutes destination taxi cost for
// destination transit cost in the all-in total, and updates the penalty field
// so effectiveCost() uses the taxi duration.

function applyDestTransferFlip(
  c: AssembledCombination,
  _partySize?: number,
): AssembledCombination {
  if (c.destination_taxi_cost_gbp == null) return c;
  // taxi_cost_gbp is a flat vehicle rate (not per-person); × 2 for round trip only
  const newTransferCost = c.destination_taxi_cost_gbp * 2;
  const delta = newTransferCost - c.destination_transfer_cost_gbp;
  return {
    ...c,
    destination_transfer_cost_gbp: newTransferCost,
    destination_transfer_is_taxi: true,
    destination_transit_duration_mins: c.destination_taxi_duration_mins,
    total_cost_gbp: c.total_cost_gbp + delta,
    total_inc_fine: c.total_inc_fine + delta,
  };
}

// ── Shared transit enrichment ─────────────────────────────────────────────────
// Collects all unique transit lookups needed for a combinations array + baseline,
// fires them in parallel, returns a raw cache with no preference override applied.

async function buildRawTransitCache(
  combinations: any[],
  baseline: any,
  postcodeDistrict: string,
  nearestAirport: string,
  adults: number,
  children: number,
  infants: number,
  checkedBags: number = 0,
): Promise<Map<string, AirportTransitCost>> {
  const childrenArr = Array.from({ length: children }, () => ({ age: 10 }));

  const transitMap = new Map<
    string,
    { postcode_district: string; airport_iata: string; departure_time: Date }
  >();

  for (const c of combinations) {
    const outKey = cacheKey(c.origin_iata, c.outbound_date, c.outbound_departure_time ?? '09:00');
    if (!transitMap.has(outKey)) {
      transitMap.set(outKey, {
        postcode_district: postcodeDistrict,
        airport_iata: c.origin_iata,
        departure_time: parseDepartureDate(c.outbound_date, c.outbound_departure_time),
      });
    }
    const retKey = cacheKey(c.ret_dest_iata, c.return_date, c.return_arrival_time ?? '09:00');
    if (!transitMap.has(retKey)) {
      transitMap.set(retKey, {
        postcode_district: postcodeDistrict,
        airport_iata: c.ret_dest_iata,
        departure_time: parseDepartureDate(c.return_date, c.return_arrival_time),
      });
    }
  }

  const baselineOutKey = cacheKey(
    nearestAirport,
    baseline.outbound_date ?? '',
    baseline.outbound_departure_time ?? '09:00',
  );
  if (!transitMap.has(baselineOutKey) && baseline.outbound_date) {
    transitMap.set(baselineOutKey, {
      postcode_district: postcodeDistrict,
      airport_iata: nearestAirport,
      departure_time: parseDepartureDate(
        baseline.outbound_date,
        baseline.outbound_departure_time ?? '09:00',
      ),
    });
  }

  const baselineRetKey = cacheKey(nearestAirport, baseline.return_date ?? '', '09:00');
  if (!transitMap.has(baselineRetKey) && baseline.return_date) {
    transitMap.set(baselineRetKey, {
      postcode_district: postcodeDistrict,
      airport_iata: nearestAirport,
      departure_time: parseDepartureDate(baseline.return_date, '09:00'),
    });
  }

  const keys = [...transitMap.keys()];
  const inputs = keys.map(k => transitMap.get(k)!);
  const results = await Promise.all(
    inputs.map(input => getTransitCost({ ...input, adults, children: childrenArr, infants, checkedBags })),
  );

  const transitCache = new Map<string, AirportTransitCost>();
  for (let i = 0; i < keys.length; i++) {
    transitCache.set(keys[i], results[i]);
  }

  return transitCache;
}

// Pure in-memory step — forces recommended_mode/cost to uber for every entry.
// 'auto' returns the raw cache as-is (getTransitCost already chose the best mode).
// Each assembleCombinationsOnly call applies this independently so transport_flip
// and the main call get the right override without sharing mutable state.
function applyTransitPreference(
  rawCache: Map<string, AirportTransitCost>,
  transitPreference: 'auto' | 'uber' | 'transit',
): Map<string, AirportTransitCost> {
  if (transitPreference === 'auto') return rawCache;
  const result = new Map<string, AirportTransitCost>();
  for (const [key, t] of rawCache) {
    if (transitPreference === 'uber') {
      result.set(key, {
        ...t,
        recommended_mode: 'uber',
        recommended_cost_pence: t.uber.mean_pence,
      });
    } else {
      result.set(key, {
        ...t,
        recommended_mode: 'transit',
        recommended_cost_pence: t.transit?.total_family_pence ?? t.recommended_cost_pence,
      });
    }
  }
  return result;
}

// ── Precomputed cache for shared-across-scenarios use ─────────────────────────
// Call once per request; pass to each assembleCombinationsOnly scenario call
// to avoid repeating resolveNearestAirport + transit DB lookups.

export interface AssemblyPrecomputed {
  nearestAirport: string;
  // Optional — absent when the caller only wants to share the airport lookup
  // but needs to build its own transit cache (e.g. bag-varying scenarios).
  rawTransitCache?: Map<string, AirportTransitCost>;
  // Per-carrier baggage fee lookup — fetched once, used by bag scenarios.
  bagFeesCache?: Map<string, BagFeeRow>;
  // Original bag counts from the RPC call — used to detect when a scenario
  // needs bag cost recalculation.
  originalCabinBags?: number;
  originalCheckedBags?: number;
}

export interface BagFeeRow {
  airline_iata: string;
  cabin_bag_included: boolean;
  full_cabin_bag_fee_gbp: number | null;
  first_checked_bag_gbp: number | null;
}

export async function buildAssemblyPrecomputed(
  combinations: any[],
  baseline: any,
  postcodeDistrict: string,
  adults: number,
  children: number,
  infants: number,
  cabinBags: number = adults,
  checkedBags: number = 0,
): Promise<AssemblyPrecomputed> {
  const nearestAirport = await resolveNearestAirport(postcodeDistrict);
  const [rawTransitCache, bagFeesCache] = await Promise.all([
    buildRawTransitCache(
      combinations, baseline, postcodeDistrict, nearestAirport,
      adults, children, infants, checkedBags,
    ),
    fetchBagFeesCache(),
  ]);
  return {
    nearestAirport,
    rawTransitCache,
    bagFeesCache,
    originalCabinBags: cabinBags,
    originalCheckedBags: checkedBags,
  };
}

async function fetchBagFeesCache(): Promise<Map<string, BagFeeRow>> {
  const { data, error } = await supabase
    .from('airline_baggage_fees')
    .select('airline_iata, cabin_bag_included, full_cabin_bag_fee_gbp, first_checked_bag_gbp');
  if (error) {
    console.error('[bagFeesCache] query failed:', error.message);
  }
  const map = new Map<string, BagFeeRow>();
  for (const row of data ?? []) {
    map.set(row.airline_iata, row as BagFeeRow);
  }
  console.log('[bagFeesCache] loaded', map.size, 'carriers:',
    [...map.entries()].map(([k, v]) => `${k}:cabin_inc=${v.cabin_bag_included},checked=£${v.first_checked_bag_gbp}`).join(', '));
  return map;
}

// ── Nearest airport lookup ────────────────────────────────────────────────────

async function resolveNearestAirport(postcodeDistrict: string): Promise<string> {
  try {
    const { supabaseServer } = await import('../supabase-server');
    const { data } = await supabaseServer
      .from('district_airport_transit')
      .select('airport_code')
      .eq('postcode_district', postcodeDistrict)
      .in('airport_code', ['LHR', 'LGW', 'STN', 'LTN', 'LCY'])
      .order('uber_distance_km', { ascending: true })
      .limit(1);
    return data?.[0]?.airport_code ?? 'LHR';
  } catch {
    return 'LHR';
  }
}

// ── Assembled baseline builder ────────────────────────────────────────────────

function buildAssembledBaseline(
  baseline: any,
  nearestAirport: string,
  transitCache: Map<string, AirportTransitCost>,
  baselineOutKey: string,
  baselineRetKey: string,
): AssembledBaseline {
  const blOutTransit = baseline.outbound_date ? transitCache.get(baselineOutKey) ?? null : null;
  const blRetTransit = baseline.return_date ? transitCache.get(baselineRetKey) ?? null : null;
  const blOutTransitGbp = (blOutTransit?.recommended_cost_pence ?? 0) / 100;
  const blRetTransitGbp = (blRetTransit?.recommended_cost_pence ?? 0) / 100;
  const blTransitCostGbp = blOutTransitGbp + blRetTransitGbp;
  const blTotalCostGbp =
    (baseline.fare_plus_ancillary_gbp ?? 0) +
    blTransitCostGbp +
    (baseline.destination_transfer_cost_gbp ?? 0);

  // Parse outbound departure time from raw_json or fallback
  const rawJson = baseline.raw_json ? JSON.parse(baseline.raw_json) : null;
  const outboundDepTime =
    rawJson?.result?.segments?.[0]?.departure?.slice(11, 16) ??
    baseline.outbound_departure_time?.slice(0, 5) ??
    '09:00';

  // Return departure time unknown for round-trip baseline — conservative default
  // until the assembleCombinationsOnly caller derives the real one from
  // fare_snapshots and recomputes eff_cost via effectiveCost().
  const returnDepTime = '09:00';

  const baselineNights = Math.round(
    (new Date(baseline.return_date + 'T00:00:00').getTime() -
     new Date(baseline.outbound_date + 'T00:00:00').getTime()) /
    (1000 * 60 * 60 * 24)
  );

  // outbound_dep_quality is display-only (AI prompt narrative) — kept here
  // using the same thresholds as buildCandidates.ts's computeQualityFields.
  // The real eff_cost is computed downstream via effectiveCost() on a properly
  // constructed AssembledCombination-shaped baseline (see
  // buildBaselineAsCombination), not duplicated here.
  const outDepHour = parseInt(outboundDepTime.slice(0, 2));
  const outDepQuality =
    outDepHour < 6  ? 'very_early' :   // before 06:00
    outDepHour < 9  ? 'very_early' :   // 06:00-09:00
    outDepHour < 14 ? 'ideal' :        // 09:00-14:00
    'good';                            // 14:00+

  return {
    outbound_date: baseline.outbound_date,
    return_date: baseline.return_date,
    origin_iata: baseline.origin_iata,
    destination_iata: baseline.destination_iata,
    carrier: baseline.carrier,
    baseline_fare_gbp: baseline.baseline_fare_gbp,
    cabin_bag_cost_gbp: baseline.cabin_bag_cost_gbp,
    checked_bag_cost_gbp: baseline.checked_bag_cost_gbp,
    seat_cost_gbp: baseline.seat_cost_gbp,
    fare_plus_ancillary_gbp: baseline.fare_plus_ancillary_gbp,
    destination_transfer_cost_gbp: baseline.destination_transfer_cost_gbp,
    destination_transfer_known: baseline.destination_transfer_known,
    destination_transfer_is_taxi: baseline.destination_transfer_is_taxi ?? false,
    destination_transit_duration_mins: baseline.destination_transit_duration_mins ?? null,
    destination_transit_changes:       baseline.destination_transit_changes ?? null,
    destination_taxi_duration_mins:    baseline.destination_taxi_duration_mins ?? null,
    destination_taxi_cost_gbp:         baseline.destination_taxi_cost_gbp ?? null,
    destination_transit_notes:         baseline.destination_transit_notes ?? null,
    destination_taxi_cost_low_gbp:     baseline.destination_taxi_cost_low_gbp ?? null,
    destination_taxi_cost_high_gbp:    baseline.destination_taxi_cost_high_gbp ?? null,
    outbound_departure_time: baseline.outbound_departure_time ?? null,
    outbound_departure_time_parsed: outboundDepTime,
    return_departure_time_assumed:  returnDepTime,
    baseline_is_fallback: baseline.baseline_is_fallback,
    baseline_airport: nearestAirport,
    family_seating_notes: baseline.family_seating_notes ?? null,
    trip_nights:                   baselineNights,
    eff_cost:                      0, // placeholder — overwritten by buildBaselineAsCombination()
    outbound_dep_quality:          outDepQuality,
    return_departure_time_derived: 'pending',
    outbound_transit_cost_gbp: blOutTransitGbp,
    return_transit_cost_gbp: blRetTransitGbp,
    transit_cost_gbp: blTransitCostGbp,
    total_cost_gbp: blTotalCostGbp,
    outbound_transit: blOutTransit,
    return_transit: blRetTransit,
  };
}

// ── Baseline normalisation ────────────────────────────────────────────────────
// Builds an AssembledCombination-shaped object from the baseline so
// effectiveCost() can score it with the exact same formula as every other
// combination, instead of duplicating the penalty math. Looks up the pieces
// AssembledBaseline doesn't carry: outbound/return leg arrival time and
// duration — baseline only stores departure time from raw_json.
//
// The baseline is, by definition, the cheapest return ticket departing the
// Saturday immediately before the holiday week — so it can never require
// school absence and can never be an inset-day departure. Those fields are
// hardcoded rather than looked up.

async function lookupFareLeg(
  originIata: string,
  destIata: string,
  date: string,
  carrier: string,
  adults: number,
  children: number,
): Promise<{ departure_time: string | null; arrival_time: string | null; duration_minutes: number | null } | null> {
  const { data: primary } = await supabase
    .from('fare_snapshots')
    .select('departure_time, arrival_time, duration_minutes')
    .eq('origin_iata', originIata)
    .eq('destination_iata', destIata)
    .eq('departure_date', date)
    .eq('adults', adults)
    .eq('children', children)
    .eq('stops', 0)
    .eq('airline_iata', carrier)
    .eq('result_bucket', 'best')
    .order('result_rank', { ascending: true })
    .limit(1);

  if (primary && primary.length > 0) return primary[0];

  // Fallback: any nonstop on that route/date (carrier may not have matched).
  const { data: fallback } = await supabase
    .from('fare_snapshots')
    .select('departure_time, arrival_time, duration_minutes')
    .eq('origin_iata', originIata)
    .eq('destination_iata', destIata)
    .eq('departure_date', date)
    .eq('stops', 0)
    .eq('result_bucket', 'best')
    .order('result_rank', { ascending: true })
    .limit(1);

  return fallback?.[0] ?? null;
}

async function buildBaselineAsCombination(
  baseline: any,
  assembledBaseline: AssembledBaseline,
  nearestAirport: string,
  adults: number,
  children: number,
): Promise<{ combination: BaselineAsCombination; scored: ScoredCombination; eff_cost: number } | null> {
  if (!baseline.outbound_date || !baseline.return_date || !baseline.origin_iata || !baseline.destination_iata) {
    return null;
  }

  const carrier = baseline.airline_iata ?? baseline.carrier;

  // The RPC builds baseline as a jsonb_build_object and does NOT include raw_json.
  // Query baseline_snapshots directly to get it.
  const { data: bsRow } = await supabase
    .from('baseline_snapshots')
    .select('raw_json')
    .eq('origin_iata', baseline.origin_iata)
    .eq('destination_iata', baseline.destination_iata)
    .eq('outbound_date', baseline.outbound_date)
    .eq('airline_iata', carrier)
    .limit(1)
    .maybeSingle();

  const rawJson = bsRow?.raw_json
    ? (typeof bsRow.raw_json === 'string' ? JSON.parse(bsRow.raw_json) : bsRow.raw_json)
    : null;
  const rawSegOut = rawJson?.result?.segments?.[0] ?? null;

  // Outbound arrival from raw_json — the baseline only has one segment (outbound).
  // Return leg times come from fare_snapshots via lookupFareLeg below.
  const outArrTimeRaw = rawSegOut?.arrival?.slice(11, 16)
    ?? rawJson?.result?.arrival?.slice(11, 16)
    ?? null;

  function durationFromSegment(seg: any): number | null {
    if (!seg) return null;
    if (typeof seg.duration === 'number') return seg.duration;
    if (seg.departure && seg.arrival) {
      return Math.round(
        (new Date(seg.arrival).getTime() - new Date(seg.departure).getTime()) / 60000,
      );
    }
    return null;
  }
  const outDurMins = durationFromSegment(rawSegOut) ?? null;

  // Return leg times from fare_snapshots (baseline departure date is outside
  // fare_snapshots coverage, but the return date falls inside the holiday window).
  const snapshotAdults   = baseline.adults   ?? adults;
  const snapshotChildren = baseline.children ?? children;
  const retLeg = await lookupFareLeg(
    baseline.destination_iata, baseline.origin_iata, baseline.return_date,
    carrier, snapshotAdults, snapshotChildren,
  );

  const outArrTime = outArrTimeRaw;
  const retDepTime = retLeg?.departure_time?.slice(0, 5) ?? null;
  const retArrTime = retLeg?.arrival_time?.slice(0, 5)   ?? null;
  const retDurMins = retLeg?.duration_minutes             ?? null;

  // Baseline ancillaries aren't split per leg the way combinations are —
  // approximate evenly across outbound/return for the per-leg fields that
  // exist purely for UI breakdowns; the totals effectiveCost() reads
  // (fare_plus_ancillary_gbp, total_cost_gbp) come straight from the baseline.
  const halfFare    = (baseline.baseline_fare_gbp ?? 0) / 2;
  const halfCabin   = assembledBaseline.cabin_bag_cost_gbp / 2;
  const halfChecked = assembledBaseline.checked_bag_cost_gbp / 2;
  const halfSeat     = assembledBaseline.seat_cost_gbp / 2;

  const combination: BaselineAsCombination = {
    outbound_date: assembledBaseline.outbound_date,
    return_date:   assembledBaseline.return_date,
    origin_iata:   assembledBaseline.origin_iata,
    out_dest_iata: assembledBaseline.destination_iata,
    ret_dest_iata: assembledBaseline.origin_iata, // symmetric round-trip — same London airport both ways
    outbound_carrier: assembledBaseline.carrier,
    return_carrier:   assembledBaseline.carrier,
    split_carrier: false,
    outbound_fare_gbp: halfFare,
    return_fare_gbp:   halfFare,
    cabin_bag_cost_gbp:   assembledBaseline.cabin_bag_cost_gbp,
    checked_bag_cost_gbp: assembledBaseline.checked_bag_cost_gbp,
    seat_cost_gbp:        assembledBaseline.seat_cost_gbp,
    fare_plus_ancillary_gbp: assembledBaseline.fare_plus_ancillary_gbp,
    outbound_cabin_bag_cost_gbp:   halfCabin,
    return_cabin_bag_cost_gbp:     halfCabin,
    outbound_checked_bag_cost_gbp: halfChecked,
    return_checked_bag_cost_gbp:   halfChecked,
    outbound_seat_cost_gbp: halfSeat,
    return_seat_cost_gbp:   halfSeat,
    outbound_ancillary_gbp: halfCabin + halfChecked + halfSeat,
    return_ancillary_gbp:   halfCabin + halfChecked + halfSeat,
    cabin_bag_cost_min_gbp:   assembledBaseline.cabin_bag_cost_gbp,
    cabin_bag_cost_max_gbp:   assembledBaseline.cabin_bag_cost_gbp,
    checked_bag_cost_min_gbp: assembledBaseline.checked_bag_cost_gbp,
    checked_bag_cost_max_gbp: assembledBaseline.checked_bag_cost_gbp,
    destination_transfer_cost_gbp: assembledBaseline.destination_transfer_cost_gbp,
    destination_transfer_known:    assembledBaseline.destination_transfer_known,
    destination_transfer_is_taxi:  assembledBaseline.destination_transfer_is_taxi,
    destination_transit_duration_mins: assembledBaseline.destination_transit_duration_mins,
    destination_transit_changes:       assembledBaseline.destination_transit_changes,
    destination_taxi_duration_mins:    assembledBaseline.destination_taxi_duration_mins,
    destination_taxi_cost_gbp:         assembledBaseline.destination_taxi_cost_gbp,
    destination_transit_notes:         assembledBaseline.destination_transit_notes,
    destination_taxi_cost_low_gbp:     assembledBaseline.destination_taxi_cost_low_gbp,
    destination_taxi_cost_high_gbp:    assembledBaseline.destination_taxi_cost_high_gbp,
    // The baseline departs the Saturday before the holiday week — by
    // definition never requires absence and is never an inset-day departure.
    requires_absence: false,
    absence_days: 0,
    absence_out_days: 0,
    absence_ret_days: 0,
    fine_gbp: 0,
    outbound_departure_time: assembledBaseline.outbound_departure_time_parsed,
    outbound_arrival_time:   outArrTime,
    outbound_duration_mins:  outDurMins,
    return_departure_time:   retDepTime,
    return_arrival_time:     retArrTime,
    return_duration_mins:    retDurMins,
    is_inset_day: false,
    baggage_is_estimate: true,
    family_split_risk: false,
    split_risk_carriers: null,
    outbound_seating_notes: assembledBaseline.family_seating_notes,
    return_seating_notes:   assembledBaseline.family_seating_notes,
    outbound_transit_cost_gbp: assembledBaseline.outbound_transit_cost_gbp,
    return_transit_cost_gbp:   assembledBaseline.return_transit_cost_gbp,
    transit_cost_gbp: assembledBaseline.transit_cost_gbp,
    total_cost_gbp:   assembledBaseline.total_cost_gbp,
    total_inc_fine:   assembledBaseline.total_cost_gbp,
    // Always populated when the baseline resolved at all — buildTransitCache
    // runs both legs for every baseline with outbound/return dates.
    outbound_transit: assembledBaseline.outbound_transit!,
    return_transit:   assembledBaseline.return_transit!,
    is_baseline: true,
  };

  const quality = computeQualityFields(combination);
  const scored: ScoredCombination = { ...combination, ...quality, pre_score: 0 };
  const effCost = effectiveCost(scored);

  const outTransit = scored.outbound_transit?.transit;
  const retTransit = scored.return_transit?.transit;
  const outLondonPenalty =
    outTransit && outTransit.confidence === 'ok'
      ? LONDON_TRANSIT_PENALTY(outTransit.duration_mins, outTransit.changes)
      : 0;
  const retLondonPenalty =
    retTransit && retTransit.confidence === 'ok'
      ? LONDON_TRANSIT_PENALTY(retTransit.duration_mins, retTransit.changes)
      : 0;
  const destPenalty = DEST_TRANSFER_PENALTY(scored.destination_transit_duration_mins);
  const baseFare = (scored.outbound_fare_gbp ?? 0) + (scored.return_fare_gbp ?? 0);
  console.log('[baseline-breakdown]', JSON.stringify({
    out: scored.outbound_date,
    ret: scored.return_date,
    carrier: scored.outbound_carrier,
    nights: quality.trip_nights,
    out_dep_time:        scored.outbound_departure_time,
    out_arr_time:        scored.outbound_arrival_time,
    ret_dep_time:        scored.return_departure_time,
    ret_arr_time:        scored.return_arrival_time,
    base_fare_gbp:       Math.round(baseFare),
    bags_cost_gbp:       Math.round((scored.fare_plus_ancillary_gbp ?? 0) - baseFare),
    out_transit_cost_gbp: Math.round(scored.outbound_transit_cost_gbp * 100) / 100,
    ret_transit_cost_gbp: Math.round(scored.return_transit_cost_gbp * 100) / 100,
    dest_transfer_gbp:   Math.round(scored.destination_transfer_cost_gbp * 100) / 100,
    total_cost_gbp:      Math.round(scored.total_cost_gbp),
    arr_q:     quality.arrival_quality,
    out_dep_q: quality.outbound_departure_quality,
    ret_dep_q: quality.return_departure_quality,
    eff_cost_breakdown: {
      total:                    Math.round(scored.total_cost_gbp),
      night_credit:             -(quality.trip_nights * NIGHT_VALUE),
      inset_credit:             0,
      arrival_penalty:          ARRIVAL_PENALTY[quality.arrival_quality ?? ''] ?? 40,
      out_dep_penalty:          OUT_DEP_PENALTY[quality.outbound_departure_quality ?? ''] ?? 35,
      ret_dep_penalty:          RET_DEP_PENALTY[quality.return_departure_quality ?? ''] ?? 35,
      out_london_penalty:       outLondonPenalty,
      ret_london_penalty:       retLondonPenalty,
      dest_transfer_penalty_x2: destPenalty * 2,
      final_eff_cost:           Math.round(effCost),
    },
  }));

  return { combination, scored, eff_cost: effCost };
}

// ── Saving category ───────────────────────────────────────────────────────────

function computeSavingCategory(
  baselineTotal: number,
  recommendationTotal: number,
  nightsDiff: number = 0,
): 'significant' | 'found_saving' | 'baseline_cheapest' {
  const rawSaving = baselineTotal - recommendationTotal;
  const adjustedSaving = rawSaving + (nightsDiff * NIGHT_VALUE);
  if (adjustedSaving >= 100) return 'significant';
  if (adjustedSaving >= 1)   return 'found_saving';
  return 'baseline_cheapest';
}

// ── Output types ──────────────────────────────────────────────────────────────

export type BaselineAsItinerary = {
  outbound_date: string;
  return_date: string;
  origin_iata: string;
  destination_iata: string;
  outbound_carrier: string;
  return_carrier: string;
  total_cost_gbp: number;
  outbound_departure_time: string | null;
};

// Return type for assembleCombinationsOnly
export type CombinationsOnlyResult = {
  combinations: AssembledCombination[];
  scoredPool: ScoredCombination[];
  baseline: AssembledBaseline;
  recommendation: AssembledCombination;
  savingCategory: 'significant' | 'found_saving' | 'baseline_cheapest';
  baselineIsRecommended: boolean;
  baselineAsItinerary: BaselineAsItinerary;
  shortlist: ScoredCombination[];
  benchmark: number | null;
  nearestAirport: string;
  cheapestViable: AssembledCombination | null;
  selection: SelectionContext | null;
  baselineAsCombination: BaselineAsCombination | null;
};

// Return type for assembleRecommendation
export type AssembledResult = CombinationsOnlyResult & {
  aiRecommendation: AIRecommendationOutput;
};

// ── assembleCombinationsOnly ──────────────────────────────────────────────────
// Fast path — no AI call. Used for initial page render.
// Returns combinations, baseline, shortlist, and benchmark.

export async function assembleCombinationsOnly(
  rawResult: any,
  postcodeDistrict: string,
  adults: number,
  children: number,
  infants: number,
  transitPreference: 'auto' | 'uber' | 'transit' = 'auto',
  cabinBags: number = adults,
  checkedBags: number = 0,
  seatsTogether: boolean = true,
  precomputed?: AssemblyPrecomputed,
): Promise<CombinationsOnlyResult> {
  const combinations: any[] = rawResult?.combinations ?? [];
  const baseline: any = rawResult?.baseline ?? {};

  console.log('[rpc-raw-keys]', Object.keys(combinations[0] ?? {}));
  console.log('[assembly] called, combinations count:', combinations.length);

  const nearestAirport = precomputed?.nearestAirport
    ?? await resolveNearestAirport(postcodeDistrict);

  // Use the precomputed transit cache when available (same bags as this call);
  // otherwise build fresh — passing this call's own checkedBags so the Uber-XL
  // multiplier fires correctly for bag-varying scenarios (travel_light, add_checked_bag).
  const rawTransitCache = precomputed?.rawTransitCache
    ?? await buildRawTransitCache(
        combinations, baseline, postcodeDistrict, nearestAirport,
        adults, children, infants, checkedBags,
      );

  // Apply per-call preference override in-memory — must not be shared across
  // scenario calls since transport_flip uses a different transitPreference.
  const transitCache = applyTransitPreference(rawTransitCache, transitPreference);

  // Derive baseline cache lookup keys locally — they depend only on nearestAirport
  // and baseline fields, both available here without needing them in precomputed.
  const baselineOutKey = cacheKey(
    nearestAirport, baseline.outbound_date ?? '', baseline.outbound_departure_time ?? '09:00',
  );
  const baselineRetKey = cacheKey(nearestAirport, baseline.return_date ?? '', '09:00');

  let assembled: AssembledCombination[] = combinations.map((c: any) => {
    if (DEBUG_ASSEMBLY_LOGS) {
      console.log('[pre-map-keys]', c.outbound_date, 'has transit_notes:', 'destination_transit_notes' in c, c.destination_transit_notes);
    }
    const outKey = cacheKey(c.origin_iata, c.outbound_date, c.outbound_departure_time ?? '09:00');
    const retKey = cacheKey(c.ret_dest_iata, c.return_date, c.return_arrival_time ?? '09:00');
    return mapCombination(c, transitCache.get(outKey)!, transitCache.get(retKey)!);
  });
  console.log('[post-map]', assembled[0]?.destination_transit_notes);

  // ── Bag cost recalculation ───────────────────────────────────────────────
  // When this call's bag params differ from the SQL-baked originals (bag
  // scenarios), recalculate per-combination bag costs from airline_baggage_fees.
  const bagFees = precomputed?.bagFeesCache;
  const origCabin   = precomputed?.originalCabinBags;
  const origChecked = precomputed?.originalCheckedBags;
  const bagsChanged = bagFees &&
    origCabin != null && origChecked != null &&
    (cabinBags !== origCabin || checkedBags !== origChecked);

  if (bagsChanged) {
    assembled = assembled.map(c => recalcBagCosts(c, cabinBags, checkedBags, bagFees));
    console.log('[assembly] bag recalc applied: cabin', origCabin, '→', cabinBags,
      'checked', origChecked, '→', checkedBags);
  }

  // ── Destination transfer flip ────────────────────────────────────────────
  // When uber mode, substitute taxi costs for transit costs at the destination.
  const partySize = adults + children + infants;
  if (transitPreference === 'uber') {
    assembled = assembled.map(c => applyDestTransferFlip(c, partySize));
  }

  assembled.sort((a, b) => a.total_inc_fine - b.total_inc_fine);

  const assembledBaseline = buildAssembledBaseline(
    baseline, nearestAirport, transitCache, baselineOutKey, baselineRetKey,
  );

  // ── Normalise the baseline into an AssembledCombination shape ─────────────
  // baseline_snapshots only stores the outbound leg fare; the return leg's
  // arrival/duration is looked up here so the baseline can be scored with
  // the same effectiveCost() formula as every other combination, instead
  // of a duplicated penalty calculation.
  let baselineNormalised = await buildBaselineAsCombination(
    baseline, assembledBaseline, nearestAirport, adults, children,
  );

  // Apply bag recalculation and destination transfer flip to baseline too.
  if (baselineNormalised) {
    let blCombo = baselineNormalised.combination as AssembledCombination;
    if (bagsChanged) {
      blCombo = recalcBagCosts(blCombo, cabinBags, checkedBags, bagFees) as BaselineAsCombination;
    }
    if (transitPreference === 'uber') {
      blCombo = applyDestTransferFlip(blCombo, partySize) as BaselineAsCombination;
    }
    if (bagsChanged || transitPreference === 'uber') {
      const quality = computeQualityFields(blCombo);
      const scored: ScoredCombination = { ...blCombo, ...quality, pre_score: 0 };
      const newEffCost = effectiveCost(scored);
      baselineNormalised = {
        combination: blCombo as BaselineAsCombination,
        scored,
        eff_cost: newEffCost,
      };
      // Propagate recalculated costs back to assembledBaseline so the returned
      // baseline object reflects bag/transfer adjustments, not SQL-baked values.
      assembledBaseline.cabin_bag_cost_gbp   = blCombo.cabin_bag_cost_gbp;
      assembledBaseline.checked_bag_cost_gbp = blCombo.checked_bag_cost_gbp;
      assembledBaseline.seat_cost_gbp        = blCombo.seat_cost_gbp;
      assembledBaseline.fare_plus_ancillary_gbp = blCombo.fare_plus_ancillary_gbp;
      assembledBaseline.total_cost_gbp       = blCombo.total_cost_gbp;
      assembledBaseline.destination_transfer_cost_gbp = blCombo.destination_transfer_cost_gbp;
      console.log('[baseline-recalc]', {
        bags_changed: bagsChanged,
        uber_flip: transitPreference === 'uber',
        checked_bag_cost: blCombo.checked_bag_cost_gbp,
        total_cost: Math.round(blCombo.total_cost_gbp),
        eff_cost: Math.round(newEffCost),
      });
    }
    assembledBaseline.eff_cost = Math.round(baselineNormalised.eff_cost);
    assembledBaseline.return_departure_time_derived =
      baselineNormalised.combination.return_departure_time ?? 'unknown';
  }

  // Score + dedupe the full pool once — this is what effectiveCost()/
  // selectCombination() run over, and what the shortlist's diversity
  // categories are drawn from. Dedup collapses same-flight-pair entries
  // (identical outbound+return+airports+carriers, different bag/seat
  // assumptions) to the cheapest representative.
  const dedupedPool = scoreAndDedupeCombinations(assembled);

  // Fold the baseline into the scored pool so selectCombination() can pick it
  // naturally if it has the lowest eff_cost. The baseline has a unique
  // outbound_date (Saturday before the holiday window) so it can never collide
  // with any holiday-window combination key.
  const scoredPool: ScoredCombination[] = baselineNormalised
    ? [...dedupedPool, baselineNormalised.scored]
    : dedupedPool;
  console.log('[scoredPool] raw:', assembled.length, 'deduped:', dedupedPool.length,
    'with_baseline:', scoredPool.length);

  // Build shortlist for AI (also returned so assembleRecommendation can reuse)
  const shortlist = buildCandidateShortlist(scoredPool);
  console.log('[shortlist] size:', shortlist.length);

  // Primary destination airport = most frequent out_dest_iata in no-absence combinations
  const noAbsenceCombinations = assembled.filter(c => !c.requires_absence);
  const destFrequency = noAbsenceCombinations.reduce((acc, c) => {
    acc[c.out_dest_iata] = (acc[c.out_dest_iata] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const primaryDestAirport = Object.entries(destFrequency)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'BCN';

  const recommendedTripNights = shortlist[0]
    ? Math.round(
        (new Date(shortlist[0].return_date + 'T00:00:00').getTime() -
         new Date(shortlist[0].outbound_date + 'T00:00:00').getTime()) /
        (1000 * 60 * 60 * 24),
      )
    : 4;

  // computeBenchmark expects ScoredCombination[] but only uses fields present on
  // AssembledCombination (total_inc_fine, outbound_date, return_date, origin_iata,
  // out_dest_iata, ret_dest_iata, requires_absence, split_carrier, trip_nights).
  const benchmark = assembled.length > 0
    ? computeBenchmark(
        assembled as any,
        baseline.outbound_date ?? '',
        nearestAirport,
        primaryDestAirport,
        recommendedTripNights,
      )
    : null;

  // Use effectiveCost() selection over the FULL deduped pool — not just the
  // shortlist. The shortlist is a diversity sample for the AI prompt; scoring
  // only that sample was the original bug (winner could only ever be one of
  // 10-15 hand-picked items, never anything the 11 categories happened to miss).
  // This is the single canonical winner — route.ts must not recompute its own.
  const selectionResult = selectCombination(scoredPool);
  const recommendation: AssembledCombination = selectionResult?.winner ?? assembled[0];

  // Live tie-band visibility: spread of effectiveCost() across the viable pool,
  // and how many fall within £25 of the winner. Logged on every request so the
  // distribution can be read straight from prod/dev logs without a DB query.
  if (selectionResult) {
    const viablePool = scoredPool.filter(c => !c.requires_absence && c.trip_nights >= 1);
    const effCosts = viablePool.map(c => effectiveCost(c)).sort((a, b) => a - b);
    const n = effCosts.length;
    const median = n % 2 === 1
      ? effCosts[(n - 1) / 2]
      : (effCosts[n / 2 - 1] + effCosts[n / 2]) / 2;
    const withinTieBand = effCosts.filter(c => c - effCosts[0] <= 25).length;
    console.log('[tie-band]', {
      pool_size: n,
      min_eff_cost: Math.round(effCosts[0]),
      max_eff_cost: Math.round(effCosts[n - 1]),
      median_eff_cost: Math.round(median),
      within_25_of_winner: withinTieBand,
    });
  }

  // Guarantee the winner is present in whatever array is sent to the AI/
  // downstream .find() lookups — otherwise those silently fall back to
  // shortlist[0] when the true winner came from outside the 11 categories.
  const shortlistWithWinner = selectionResult
    ? withWinnerIncluded(shortlist, selectionResult.winner)
    : shortlist;

  // Cheapest viable combination by raw total_cost_gbp (for "vs cheapest" copy).
  // cheapestOverall may now be the baseline (is_baseline: true) — in that case
  // there is no meaningful "vs cheapest holiday-window option" comparison, so null.
  const cheapestViable: AssembledCombination | null =
    selectionResult?.cheapestOverall && !(selectionResult.cheapestOverall as any).is_baseline
      ? assembled.find(c =>
          c.outbound_date    === selectionResult.cheapestOverall.outbound_date &&
          c.return_date      === selectionResult.cheapestOverall.return_date &&
          c.outbound_carrier === selectionResult.cheapestOverall.outbound_carrier
        ) ?? null
      : null;

  // recommendation IS selectionResult.winner — effectiveCost already computed,
  // no need to re-find it in the shortlist (that's the bug this replaces).
  const recEffCost = selectionResult
    ? selectionResult.winnerEffCost
    : recommendation.total_cost_gbp;
  const isBaselineWinner = (recommendation as any).is_baseline === true;
  const savingCategory = isBaselineWinner
    ? 'baseline_cheapest' as const
    : computeSavingCategory(
        assembledBaseline.eff_cost,
        recEffCost,
        0,
      );
  console.log('[selection]', {
    winner_out:    recommendation.outbound_date,
    winner_ret:    recommendation.return_date,
    winner_total:  recommendation.total_cost_gbp,
    winner_eff:    recEffCost,
    winner_is_baseline: (recommendation as any).is_baseline === true,
    savingCategory,
  });
  console.log('[selectCombination-winner]', {
    out:     recommendation.outbound_date,
    ret:     recommendation.return_date,
    carrier: recommendation.outbound_carrier + '+' + recommendation.return_carrier,
    nights:  selectionResult?.winner.trip_nights ?? null,
    total:   recommendation.total_cost_gbp,
    eff:     recEffCost,
  });
  const baselineIsRecommended = savingCategory === 'baseline_cheapest';
  const baselineAsItinerary: BaselineAsItinerary = {
    outbound_date: assembledBaseline.outbound_date,
    return_date: assembledBaseline.return_date,
    origin_iata: assembledBaseline.origin_iata,
    destination_iata: assembledBaseline.destination_iata,
    outbound_carrier: assembledBaseline.carrier,
    return_carrier: assembledBaseline.carrier,
    total_cost_gbp: assembledBaseline.total_cost_gbp,
    outbound_departure_time: assembledBaseline.outbound_departure_time,
  };

  console.log('[shortlist-0]', shortlistWithWinner[0]?.destination_transit_notes);

  return {
    combinations: assembled,
    scoredPool,
    baseline: assembledBaseline,
    recommendation,
    savingCategory,
    baselineIsRecommended,
    baselineAsItinerary,
    shortlist: shortlistWithWinner,
    benchmark,
    nearestAirport,
    cheapestViable,
    selection: selectionResult,
    baselineAsCombination: baselineNormalised?.combination ?? null,
  };
}

// ── assembleRecommendation ────────────────────────────────────────────────────
// Full path — calls assembleCombinationsOnly then fires AI recommendation.
// The AI receives the shortlist (10-15 curated combinations) not all 128.

export async function assembleRecommendation(
  rawResult: any,
  postcodeDistrict: string,
  adults: number,
  children: number,
  infants: number,
  transitPreference: 'auto' | 'uber' | 'transit' = 'auto',
  schoolName: string | null = null,
  borough: string | null = null,
  windowStart: string = '',
  windowEnd: string = '',
  cabinBags: number = adults,
  checkedBags: number = 0,
  seatsTogether: boolean = true,
): Promise<AssembledResult> {
  // Reuse assembleCombinationsOnly — no duplication
  const base = await assembleCombinationsOnly(
    rawResult,
    postcodeDistrict,
    adults,
    children,
    infants,
    transitPreference,
    cabinBags,
    checkedBags,
    seatsTogether,
  );

  // ── Fine/absence-aware saving fields ────────────────────────────────────
  // Computed here (not in getAIRecommendation) so the warning logic is
  // testable independent of the LLM call.
  const winner         = base.recommendation;
  const baselineAllin  = base.baseline.total_cost_gbp;
  const winnerTotal    = winner.total_cost_gbp;
  const fineGbp        = winner.fine_gbp ?? 0;
  const absenceDays    = winner.absence_days ?? 0;
  const absenceOutDays = winner.absence_out_days ?? 0;
  const absenceRetDays = winner.absence_ret_days ?? 0;
  const savingVsBaseline = baselineAllin - winnerTotal;
  const fineWipesSaving  = absenceDays > 0 && fineGbp > savingVsBaseline;
  const netCost  = winnerTotal + fineGbp;
  const netDelta = netCost - baselineAllin; // positive = net worse off vs baseline
  const termResumeDateIso = windowEnd
    ? (() => {
        const d = new Date(windowEnd + 'T00:00:00');
        d.setDate(d.getDate() + 1);
        return d.toISOString().slice(0, 10);
      })()
    : '';

  // ── Best alternative that avoids the fine (or just the runner-up) ────────
  const winnerCombinationKey = combinationKey(winner);
  const alternatives = base.scoredPool
    .filter(c =>
      !(c as any).is_baseline &&
      combinationKey(c) !== winnerCombinationKey &&
      (absenceDays > 0 ? c.absence_days === 0 : true),
    )
    .sort((a, b) => effectiveCost(a) - effectiveCost(b));
  const bestNoFineAlternative = alternatives[0] ?? null;

  const fmtDateLong = (iso: string): string => {
    const d = new Date(iso + 'T00:00:00');
    const dayName = d.toLocaleDateString('en-GB', { weekday: 'long' });
    return `${dayName} ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`;
  };
  const termResumeDate = termResumeDateIso ? fmtDateLong(termResumeDateIso) : '';

  const altTotalCost = bestNoFineAlternative ? Math.round(bestNoFineAlternative.total_cost_gbp) : null;
  // Raw IATA codes — getAIRecommendation.ts turns these into full carrier
  // names ("Vueling outbound, Ryanair return") using its own cn() map.
  const altOutboundCarrier = bestNoFineAlternative?.outbound_carrier ?? null;
  const altReturnCarrier   = bestNoFineAlternative?.return_carrier ?? null;
  const altOriginIata = bestNoFineAlternative?.origin_iata ?? null;
  const altOutboundDateFormatted = bestNoFineAlternative ? fmtDateLong(bestNoFineAlternative.outbound_date) : null;
  const altReturnDateFormatted   = bestNoFineAlternative ? fmtDateLong(bestNoFineAlternative.return_date) : null;
  const altAbsenceDays = bestNoFineAlternative ? (bestNoFineAlternative.absence_days ?? 0) : null;
  const altDeltaVsWinner = bestNoFineAlternative ? Math.round(bestNoFineAlternative.total_cost_gbp - winnerTotal) : null;
  const altHasFine = bestNoFineAlternative ? (bestNoFineAlternative.absence_days ?? 0) > 0 : false;
  const altRetDepTime = bestNoFineAlternative?.return_departure_time?.slice(0, 5) ?? null;
  const altArrQ = bestNoFineAlternative?.arrival_quality ?? null;

  // ── Quality context for the "why this over the alternatives" card ────────
  // winner (AssembledCombination) doesn't carry quality fields at the type
  // level, but the runtime object is always the scored-pool winner.
  const winnerScored = winner as any;
  const winnerOutDepTime    = winnerScored.outbound_departure_time?.toString().slice(0, 5) ?? '';
  const winnerOutDepQuality = winnerScored.outbound_departure_quality ?? '';
  const winnerArrTime       = winnerScored.outbound_arrival_time?.toString().slice(0, 5) ?? '';
  const winnerArrQuality    = winnerScored.arrival_quality ?? '';
  const winnerRetDepTime    = winnerScored.return_departure_time?.toString().slice(0, 5) ?? '';
  const winnerRetDepQuality = winnerScored.return_departure_quality ?? '';

  const blScored = base.scoredPool.find(c => (c as any).is_baseline);
  const baselineOutDepTime    = base.baselineAsCombination?.outbound_departure_time?.toString().slice(0, 5) ?? undefined;
  const baselineOutDepQuality = blScored?.outbound_departure_quality ?? undefined;

  const altOutDepQuality = bestNoFineAlternative?.outbound_departure_quality ?? null;
  const altOutDepTime    = bestNoFineAlternative?.outbound_departure_time?.toString().slice(0, 5) ?? null;
  const altArrTime       = bestNoFineAlternative?.outbound_arrival_time?.toString().slice(0, 5) ?? null;
  const altRetDepQuality = bestNoFineAlternative?.return_departure_quality ?? null;

  // Single most meaningful quality contrast — first matching rule wins,
  // falling through to cost_driven when nothing distinctive applies.
  const winnerQualityAdvantage: string = (() => {
    if (winnerOutDepQuality === 'ideal' && baselineOutDepQuality === 'very_early') {
      return 'departure_vs_baseline';
    }
    if (
      (winnerArrQuality === 'excellent' || winnerArrQuality === 'good') &&
      (altArrQ === 'acceptable' || altArrQ === 'poor')
    ) {
      return 'arrival_vs_alternative';
    }
    if (winnerRetDepQuality !== 'very_early' && altRetDepQuality === 'very_early') {
      return 'return_vs_alternative';
    }
    return 'cost_driven';
  })();

  // AI receives shortlist — not all 128 combinations
  const aiRecommendation = await getAIRecommendation(base.shortlist, {
    schoolName,
    borough,
    postcodeDistrict,
    windowStart,
    windowEnd,
    adults,
    children,
    infants,
    cabinBags,
    checkedBags,
    seatsTogether,
    benchmarkCost: base.benchmark,
    savingCategory: base.savingCategory,
    combinationCount: base.combinations.length,
    absence_days:        absenceDays,
    absence_out_days:    absenceOutDays,
    absence_ret_days:    absenceRetDays,
    term_resume_date:    termResumeDate,
    fine_gbp:             fineGbp,
    fine_wipes_saving:    fineWipesSaving,
    net_cost_with_fine:   netCost,
    net_delta_with_fine:  netDelta,
    alt_total_cost:               altTotalCost,
    alt_outbound_carrier:          altOutboundCarrier,
    alt_return_carrier:            altReturnCarrier,
    alt_origin_iata:               altOriginIata,
    alt_outbound_date_formatted:  altOutboundDateFormatted,
    alt_return_date_formatted:    altReturnDateFormatted,
    alt_absence_days:              altAbsenceDays,
    alt_delta_vs_winner:           altDeltaVsWinner,
    alt_has_fine:                  altHasFine,
    alt_ret_dep_time:              altRetDepTime,
    alt_arr_q:                     altArrQ,
    winner_out_dep_time:      winnerOutDepTime,
    winner_out_dep_quality:   winnerOutDepQuality,
    winner_arr_time:          winnerArrTime,
    winner_arr_quality:       winnerArrQuality,
    winner_ret_dep_time:      winnerRetDepTime,
    winner_ret_dep_quality:   winnerRetDepQuality,
    baseline_out_dep_time:    baselineOutDepTime,
    alt_out_dep_quality:      altOutDepQuality,
    alt_out_dep_time:         altOutDepTime,
    alt_arr_time:             altArrTime,
    alt_ret_dep_quality:      altRetDepQuality,
    winner_quality_advantage: winnerQualityAdvantage,
    trueCheapest_total_cost:  base.cheapestViable?.total_cost_gbp,
    trueCheapest_trip_nights: base.cheapestViable
      ? Math.round(
          (new Date(base.cheapestViable.return_date + 'T00:00:00').getTime() -
           new Date(base.cheapestViable.outbound_date + 'T00:00:00').getTime()) /
          (1000 * 60 * 60 * 24)
        )
      : undefined,
    trueCheapest_outbound:    base.cheapestViable?.outbound_date,
    trueCheapest_return:      base.cheapestViable?.return_date,
    trueCheapest_carrier:     base.cheapestViable?.outbound_carrier,
    baseline_eff_cost:        base.baseline.eff_cost,
    baseline_out_dep_quality: base.baseline.outbound_dep_quality,
    baseline_fare:            base.baseline.baseline_fare_gbp,
    baseline_allin:           base.baseline.total_cost_gbp,
    baseline_ret_dep_time:    base.baseline.return_departure_time_derived,
    baseline_airport_name:    (() => {
      const AIRPORT_NAMES: Record<string, string> = {
        LHR: 'Heathrow', LGW: 'Gatwick', STN: 'Stansted',
        LTN: 'Luton',    LCY: 'City',
      };
      return AIRPORT_NAMES[base.baseline.origin_iata] ?? base.baseline.origin_iata;
    })(),
    baseline_arr_quality:     (() => {
      const blS = base.scoredPool.find(c => (c as any).is_baseline);
      return blS?.arrival_quality ?? undefined;
    })(),
    baseline_ret_dep_quality: (() => {
      const blS = base.scoredPool.find(c => (c as any).is_baseline);
      return blS?.return_departure_quality ?? undefined;
    })(),
    baseline_out_arr_time:    base.baselineAsCombination?.outbound_arrival_time ?? undefined,
    baseline_ret_arr_time:    base.baselineAsCombination?.return_arrival_time ?? undefined,
    baseline_origin_iata:     base.baselineAsCombination?.origin_iata ?? undefined,
    baseline_dest_iata:       base.baselineAsCombination?.out_dest_iata ?? undefined,
    baseline_outbound_date:   base.baselineAsCombination?.outbound_date ?? undefined,
    baseline_return_date:     base.baselineAsCombination?.return_date ?? undefined,
    baseline_trip_nights:     (() => {
      const blS = base.scoredPool.find(c => (c as any).is_baseline);
      return blS?.trip_nights ?? undefined;
    })(),
    baseline_carrier:         base.baselineAsCombination?.outbound_carrier ?? undefined,
    baseline_out_transit_mode: (() => {
      const t = base.baselineAsCombination?.outbound_transit;
      if (!t) return undefined;
      if (t.recommended_mode === 'uber') return 'Uber';
      const r = t.transit?.route_summary ?? '';
      if (/piccadilly|underground|tube/i.test(r)) return 'tube';
      if (/train|rail|thameslink|gatwick express|stansted express/i.test(r)) return 'train';
      if (/elizabeth|crossrail/i.test(r)) return 'Elizabeth line';
      if (/bus/i.test(r)) return 'bus';
      if (/coach/i.test(r)) return 'coach';
      return 'public transport';
    })(),
    baseline_ret_transit_mode: (() => {
      const t = base.baselineAsCombination?.return_transit;
      if (!t) return undefined;
      if (t.recommended_mode === 'uber') return 'Uber';
      const r = t.transit?.route_summary ?? '';
      if (/piccadilly|underground|tube/i.test(r)) return 'tube';
      if (/train|rail|thameslink|gatwick express|stansted express/i.test(r)) return 'train';
      if (/elizabeth|crossrail/i.test(r)) return 'Elizabeth line';
      if (/bus/i.test(r)) return 'bus';
      if (/coach/i.test(r)) return 'coach';
      return 'public transport';
    })(),
    bestInsetFromPool: (() => {
      const insets = base.scoredPool
        .filter((c: any) => c.is_inset_day && !c.is_baseline)
        .sort((a: any, b: any) => effectiveCost(a) - effectiveCost(b));
      const best = insets[0];
      if (!best) return undefined;
      return {
        outbound_date: best.outbound_date,
        return_date: best.return_date,
        outbound_departure_time: best.outbound_departure_time ?? null,
        return_departure_time: best.return_departure_time ?? null,
        total_cost_gbp: best.total_cost_gbp,
        trip_nights: best.trip_nights,
        arrival_quality: best.arrival_quality ?? null,
        outbound_carrier: best.outbound_carrier,
        return_carrier: best.return_carrier,
        origin_iata: best.origin_iata,
        out_dest_iata: best.out_dest_iata,
      };
    })(),
    lcc_cabin_bag_min_fee: undefined,
    lcc_cabin_bag_max_fee: undefined,
    partySize: adults + children + infants,
    destinationName: 'Barcelona',
    transitPreference,
    scenarios: [],
  });

  // Use selectCombination winner directly — AI writes copy only, never selects.
  const recommendation = base.recommendation;

  const baselineNights = Math.round(
    (new Date(base.baseline.return_date + 'T00:00:00').getTime() -
     new Date(base.baseline.outbound_date + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24)
  );
  const recNights = Math.round(
    (new Date(recommendation.return_date + 'T00:00:00').getTime() -
     new Date(recommendation.outbound_date + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24)
  );
  const nightsDiff = recNights - baselineNights;
  // recommendation IS base.selection.winner — reuse its already-computed
  // effectiveCost rather than re-finding it via a shortlist .find().
  const recEffCost2 = base.selection?.winnerEffCost ?? recommendation.total_cost_gbp;
  const isBaselineWinner2 = (recommendation as any).is_baseline === true;
  const savingCategory = isBaselineWinner2
    ? 'baseline_cheapest' as const
    : computeSavingCategory(
        base.baseline.eff_cost,
        recEffCost2,
        0, // nightsDiff already baked into eff_cost
      );
  console.log('[savingCategory-eff]', {
    baseline_eff_cost:        base.baseline.eff_cost,
    recommendation_eff_cost:  recEffCost2,
    savingCategory,
  });
  const baselineIsRecommended = savingCategory === 'baseline_cheapest';
  const baselineAsItinerary: BaselineAsItinerary = {
    outbound_date: base.baseline.outbound_date,
    return_date: base.baseline.return_date,
    origin_iata: base.baseline.origin_iata,
    destination_iata: base.baseline.destination_iata,
    outbound_carrier: base.baseline.carrier,
    return_carrier: base.baseline.carrier,
    total_cost_gbp: base.baseline.total_cost_gbp,
    outbound_departure_time: base.baseline.outbound_departure_time,
  };

  return {
    ...base,
    recommendation,
    savingCategory,
    baselineIsRecommended,
    baselineAsItinerary,
    aiRecommendation,
  };
}
