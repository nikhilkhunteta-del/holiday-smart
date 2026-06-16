import { getTransitCost, type AirportTransitCost } from './transitCost';
import { getAIRecommendation, type AIRecommendationOutput } from './getAIRecommendation';
import { buildCandidateShortlist, computeBenchmark, computeCostRange, type ScoredCombination, type CostRange } from './buildCandidates';
import { NIGHT_VALUE, effectiveCost, DEST_TRANSFER_PENALTY, LONDON_TRANSIT_PENALTY, OUT_DEP_PENALTY, selectCombination } from './selectCombination';
import { supabaseServer as supabase } from '@/lib/supabase-server';

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
  destination_transit_duration_mins: number | null;
  destination_transit_changes:       number | null;
  destination_taxi_duration_mins:    number | null;
  destination_taxi_cost_gbp:         number | null;
  requires_absence: boolean;
  absence_days: number;
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
  destination_transit_duration_mins: number | null;
  destination_transit_changes:       number | null;
  destination_taxi_duration_mins:    number | null;
  destination_taxi_cost_gbp:         number | null;
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
    destination_transit_duration_mins: c.destination_transit_duration_mins ?? null,
    destination_transit_changes:       c.destination_transit_changes ?? null,
    destination_taxi_duration_mins:    c.destination_taxi_duration_mins ?? null,
    destination_taxi_cost_gbp:         c.destination_taxi_cost_gbp ?? null,
    requires_absence: c.requires_absence,
    absence_days: c.absence_days,
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

// ── Shared transit enrichment ─────────────────────────────────────────────────
// Collects all unique transit lookups needed for a combinations array + baseline,
// fires them in parallel, returns a populated transit cache.

async function buildTransitCache(
  combinations: any[],
  baseline: any,
  postcodeDistrict: string,
  nearestAirport: string,
  adults: number,
  children: number,
  infants: number,
  transitPreference: 'auto' | 'uber',
): Promise<{
  transitCache: Map<string, AirportTransitCost>;
  baselineOutKey: string;
  baselineRetKey: string;
}> {
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
    inputs.map(input => getTransitCost({ ...input, adults, children: childrenArr, infants })),
  );

  const transitCache = new Map<string, AirportTransitCost>();
  for (let i = 0; i < keys.length; i++) {
    transitCache.set(keys[i], results[i]);
  }

  if (transitPreference === 'uber') {
    for (const [key, t] of transitCache) {
      transitCache.set(key, {
        ...t,
        recommended_mode: 'uber',
        recommended_cost_pence: t.uber.mean_pence,
      });
    }
  }

  return { transitCache, baselineOutKey, baselineRetKey };
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

// ── Departure time quality helpers ───────────────────────────────────────────

function baselineRetPenalty(time: string): number {
  const h = parseInt(time.slice(0, 2));
  if (h < 9)  return 55;
  if (h < 13) return 25;
  if (h < 14) return 10;
  return 0;
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
  const returnDepTime = '09:00';

  const baselineNights = Math.round(
    (new Date(baseline.return_date + 'T00:00:00').getTime() -
     new Date(baseline.outbound_date + 'T00:00:00').getTime()) /
    (1000 * 60 * 60 * 24)
  );

  // Map departure hour to OUT_DEP_PENALTY key using same thresholds as
  // buildCandidates.ts's computeQualityFields (before 09:00 = very_early).
  const outDepHour = parseInt(outboundDepTime.slice(0, 2));
  const outDepQuality =
    outDepHour < 6  ? 'very_early' :   // before 06:00
    outDepHour < 9  ? 'very_early' :   // 06:00-09:00
    outDepHour < 14 ? 'ideal' :        // 09:00-14:00
    'good';                            // 14:00+

  const outDepPenalty = OUT_DEP_PENALTY[outDepQuality] ?? 35;
  const retDepPenalty = baselineRetPenalty(returnDepTime);

  const blOutLondonTransit = blOutTransit?.transit;
  const outLondonPenalty =
    blOutLondonTransit && blOutLondonTransit.confidence === 'ok'
      ? LONDON_TRANSIT_PENALTY(blOutLondonTransit.duration_mins, blOutLondonTransit.changes)
      : 0;

  const blRetLondonTransit = blRetTransit?.transit;
  const retLondonPenalty =
    blRetLondonTransit && blRetLondonTransit.confidence === 'ok'
      ? LONDON_TRANSIT_PENALTY(blRetLondonTransit.duration_mins, blRetLondonTransit.changes)
      : 0;

  const destPenalty = DEST_TRANSFER_PENALTY(baseline.destination_transit_duration_mins ?? null);

  const baselineEffCost =
    blTotalCostGbp
    - (baselineNights * NIGHT_VALUE)
    + outDepPenalty
    + retDepPenalty
    + outLondonPenalty
    + retLondonPenalty
    + (destPenalty * 2);

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
    destination_transit_duration_mins: baseline.destination_transit_duration_mins ?? null,
    destination_transit_changes:       baseline.destination_transit_changes ?? null,
    destination_taxi_duration_mins:    baseline.destination_taxi_duration_mins ?? null,
    destination_taxi_cost_gbp:         baseline.destination_taxi_cost_gbp ?? null,
    outbound_departure_time: baseline.outbound_departure_time ?? null,
    outbound_departure_time_parsed: outboundDepTime,
    return_departure_time_assumed:  returnDepTime,
    baseline_is_fallback: baseline.baseline_is_fallback,
    baseline_airport: nearestAirport,
    family_seating_notes: baseline.family_seating_notes ?? null,
    trip_nights:                   baselineNights,
    eff_cost:                      Math.round(baselineEffCost),
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

// ── Saving category ───────────────────────────────────────────────────────────

function computeSavingCategory(
  baselineTotal: number,
  recommendationTotal: number,
  nightsDiff: number = 0,
): 'significant' | 'modest' | 'minimal' | 'baseline_cheapest' {
  // Raw saving: positive means recommendation is cheaper
  const rawSaving = baselineTotal - recommendationTotal;
  // Adjust for extra nights — paying more for extra nights
  // is still good value if the premium is under NIGHT_VALUE
  const adjustedSaving = rawSaving + (nightsDiff * NIGHT_VALUE);
  if (adjustedSaving >= 75) return 'significant';
  if (adjustedSaving >= 20) return 'modest';
  if (adjustedSaving >= 0)  return 'minimal';
  return 'baseline_cheapest';
}

// ── Output types ──────────────────────────────────────────────────────────────

export type BaselineAsItinerary = {
  outbound_date: string;
  return_date: string;
  origin_iata: string;
  outbound_carrier: string;
  return_carrier: string;
  total_cost_gbp: number;
  outbound_departure_time: string | null;
};

// Return type for assembleCombinationsOnly
export type CombinationsOnlyResult = {
  combinations: AssembledCombination[];
  baseline: AssembledBaseline;
  recommendation: AssembledCombination;
  savingCategory: 'significant' | 'modest' | 'minimal' | 'baseline_cheapest';
  baselineIsRecommended: boolean;
  baselineAsItinerary: BaselineAsItinerary;
  shortlist: ScoredCombination[];
  benchmark: number | null;
  nearestAirport: string;
  cheapestViable: AssembledCombination | null;
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
  transitPreference: 'auto' | 'uber' = 'auto',
  cabinBags: number = adults,
  checkedBags: number = 0,
  seatsTogether: boolean = true,
): Promise<CombinationsOnlyResult> {
  const combinations: any[] = rawResult?.combinations ?? [];
  const baseline: any = rawResult?.baseline ?? {};

  console.log('[assembly] called, combinations count:', combinations.length);

  const nearestAirport = await resolveNearestAirport(postcodeDistrict);

  const { transitCache, baselineOutKey, baselineRetKey } = await buildTransitCache(
    combinations,
    baseline,
    postcodeDistrict,
    nearestAirport,
    adults,
    children,
    infants,
    transitPreference,
  );

  const assembled: AssembledCombination[] = combinations.map((c: any) => {
    const outKey = cacheKey(c.origin_iata, c.outbound_date, c.outbound_departure_time ?? '09:00');
    const retKey = cacheKey(c.ret_dest_iata, c.return_date, c.return_arrival_time ?? '09:00');
    return mapCombination(c, transitCache.get(outKey)!, transitCache.get(retKey)!);
  });

  assembled.sort((a, b) => a.total_inc_fine - b.total_inc_fine);

  const assembledBaseline = buildAssembledBaseline(
    baseline, nearestAirport, transitCache, baselineOutKey, baselineRetKey,
  );

  // ── Derive baseline return departure time from fare_snapshots ─────────────
  // baseline_snapshots only stores the outbound leg; we join fare_snapshots
  // to find the return departure time so we can apply the correct penalty.

  let baselineRetTime: string | null = null;

  if (baseline.destination_iata && baseline.origin_iata && baseline.return_date) {
    // Primary: same airline, nonstop, result_bucket='best'
    const { data: retRows } = await supabase
      .from('fare_snapshots')
      .select('departure_time, airline_iata')
      .eq('origin_iata',      baseline.destination_iata)
      .eq('destination_iata', baseline.origin_iata)
      .eq('departure_date',   baseline.return_date)
      .eq('adults',           baseline.adults ?? 2)
      .eq('children',         baseline.children ?? 0)
      .eq('stops',            0)
      .eq('airline_iata',     baseline.airline_iata ?? baseline.carrier)
      .eq('result_bucket',    'best')
      .order('result_rank', { ascending: true })
      .limit(1);

    if (retRows && retRows.length > 0) {
      baselineRetTime = retRows[0].departure_time?.slice(0, 5) ?? null;
    }

    // Fallback: any nonstop return on that date
    if (!baselineRetTime) {
      const { data: fbRows } = await supabase
        .from('fare_snapshots')
        .select('departure_time, airline_iata')
        .eq('origin_iata',      baseline.destination_iata)
        .eq('destination_iata', baseline.origin_iata)
        .eq('departure_date',   baseline.return_date)
        .eq('stops',            0)
        .eq('result_bucket',    'best')
        .order('result_rank', { ascending: true })
        .limit(1);

      if (fbRows && fbRows.length > 0) {
        baselineRetTime = fbRows[0].departure_time?.slice(0, 5) ?? null;
      }
    }
  }

  // Apply return penalty — zero if time unknown (conservative)
  const baselineRetHour = baselineRetTime ? parseInt(baselineRetTime.slice(0, 2)) : null;
  const baselineRetPenaltyDerived =
    baselineRetHour === null ? 0
    : baselineRetHour < 9   ? 55
    : baselineRetHour < 13  ? 25
    : baselineRetHour < 17  ? 10
    : 0;

  // The eff_cost from buildAssembledBaseline used returnDepTime='09:00' (penalty=25).
  // Recompute: subtract the default 25 and add the derived penalty.
  assembledBaseline.eff_cost = Math.round(
    assembledBaseline.eff_cost - 25 + baselineRetPenaltyDerived
  );
  assembledBaseline.return_departure_time_derived = baselineRetTime ?? 'unknown';

  // Build shortlist for AI (also returned so assembleRecommendation can reuse)
  const shortlist = buildCandidateShortlist(assembled);
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

  // Use effectiveCost() selection — this is the canonical winner across all
  // downstream uses (nights, inset bonus, departure/arrival quality, London
  // transit, destination transfer penalties all factored in).
  const selectionResult = selectCombination(shortlist);
  const recommendation: AssembledCombination = selectionResult?.winner ?? assembled[0];

  // Cheapest viable combination by raw total_cost_gbp (for "vs cheapest" copy) —
  // sourced from selectionResult so there's a single source of truth.
  const cheapestViable: AssembledCombination | null = selectionResult?.cheapestOverall
    ? assembled.find(c =>
        c.outbound_date    === selectionResult.cheapestOverall.outbound_date &&
        c.return_date      === selectionResult.cheapestOverall.return_date &&
        c.outbound_carrier === selectionResult.cheapestOverall.outbound_carrier
      ) ?? null
    : null;

  const recShortlistEntry = shortlist.find(c =>
    c.outbound_date    === recommendation.outbound_date &&
    c.return_date      === recommendation.return_date &&
    c.outbound_carrier === recommendation.outbound_carrier
  ) ?? shortlist[0];

  const recEffCost = selectionResult
    ? effectiveCost(recShortlistEntry)
    : recommendation.total_cost_gbp;
  const savingCategory = computeSavingCategory(
    assembledBaseline.eff_cost,
    recEffCost,
    0,
  );
  console.log('[selection]', {
    winner_out:   recommendation.outbound_date,
    winner_ret:   recommendation.return_date,
    winner_total: recommendation.total_cost_gbp,
    winner_eff:   recEffCost,
    baseline_eff: assembledBaseline.eff_cost,
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
    outbound_carrier: assembledBaseline.carrier,
    return_carrier: assembledBaseline.carrier,
    total_cost_gbp: assembledBaseline.total_cost_gbp,
    outbound_departure_time: assembledBaseline.outbound_departure_time,
  };

  return {
    combinations: assembled,
    baseline: assembledBaseline,
    recommendation,
    savingCategory,
    baselineIsRecommended,
    baselineAsItinerary,
    shortlist,
    benchmark,
    nearestAirport,
    cheapestViable,
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
  transitPreference: 'auto' | 'uber' = 'auto',
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
  );

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
  const recEffCost2 = effectiveCost(
    base.shortlist.find(c =>
      c.outbound_date    === recommendation.outbound_date &&
      c.return_date      === recommendation.return_date &&
      c.outbound_carrier === recommendation.outbound_carrier
    ) ?? base.shortlist[0]
  );
  const savingCategory = computeSavingCategory(
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
