import { getTransitCost, type AirportTransitCost } from './transitCost';

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
  cabin_bag_cost_gbp: number;
  checked_bag_cost_gbp: number;
  seat_cost_gbp: number;
  fare_plus_ancillary_gbp: number;
  destination_transfer_cost_gbp: number;
  destination_transfer_known: boolean;
  requires_absence: boolean;
  absence_days: number;
  fine_gbp: number | null;
  outbound_departure_time: string | null;
  return_arrival_time: string | null;
  is_inset_day: boolean;
  baggage_is_estimate: boolean;
  family_split_risk: boolean;
  split_risk_carriers: string[] | null;
  // Transit-enriched fields
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
  outbound_departure_time: string | null;
  baseline_is_fallback: boolean;
  baseline_airport: string;
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
  // timeStr may be a full ISO string or just HH:MM
  const timePart = time.includes('T') ? time.split('T')[1].slice(0, 5) : time.slice(0, 5);
  return new Date(`${dateStr}T${timePart}:00`);
}

// ── Main export ───────────────────────────────────────────────────────────────

export type BaselineAsItinerary = {
  outbound_date: string;
  return_date: string;
  origin_iata: string;
  outbound_carrier: string;
  return_carrier: string;
  total_cost_gbp: number;
  outbound_departure_time: string | null;
};

export async function assembleRecommendation(
  rawResult: any,
  postcodeDistrict: string,
  adults: number,
  children: number,
  infants: number,
  transitPreference: 'auto' | 'uber' = 'auto',
): Promise<{
  combinations: AssembledCombination[];
  baseline: AssembledBaseline;
  recommendation: AssembledCombination;
  savingCategory: 'significant' | 'modest' | 'minimal' | 'baseline_cheapest';
  baselineIsRecommended: boolean;
  baselineAsItinerary: BaselineAsItinerary;
}> {
  const combinations: any[] = rawResult?.combinations ?? [];
  const baseline: any = rawResult?.baseline ?? {};

  // Fabricate children array — use age 10 (school-age, child fare for all carriers)
  const childrenArr = Array.from({ length: children }, () => ({ age: 10 }));

  // ── Collect all unique transit calls ──────────────────────────────────────────
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

  // Resolve nearest London airport for this postcode district
  let nearestAirport = 'LHR';
  try {
    const { supabaseServer } = await import('../supabase-server');
    const { data: nearestData } = await supabaseServer
      .from('district_airport_transit')
      .select('airport_code')
      .eq('postcode_district', postcodeDistrict)
      .in('airport_code', ['LHR', 'LGW', 'STN', 'LTN', 'LCY'])
      .order('uber_distance_km', { ascending: true })
      .limit(1);
    if (nearestData?.[0]?.airport_code) {
      nearestAirport = nearestData[0].airport_code;
    }
  } catch {
    // fall back to LHR
  }

  // Baseline: nearest airport to postcode district, always 09:00
  const baselineOutKey = cacheKey(nearestAirport, baseline.outbound_date ?? '', baseline.outbound_departure_time ?? '09:00');
  if (!transitMap.has(baselineOutKey) && baseline.outbound_date) {
    transitMap.set(baselineOutKey, {
      postcode_district: postcodeDistrict,
      airport_iata: nearestAirport,
      departure_time: parseDepartureDate(baseline.outbound_date, baseline.outbound_departure_time ?? '09:00'),
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

  // ── Issue all unique transit calls in parallel ─────────────────────────────
  const keys = [...transitMap.keys()];
  const inputs = keys.map(k => transitMap.get(k)!);

  const results = await Promise.all(
    inputs.map(input =>
      getTransitCost({ ...input, adults, children: childrenArr, infants }),
    ),
  );

  const transitCache = new Map<string, AirportTransitCost>();
  for (let i = 0; i < keys.length; i++) {
    transitCache.set(keys[i], results[i]);
  }

  // ── Apply transit preference override ─────────────────────────────────────
  // When 'uber': skip the 4-rule logic — use uber mean (already XL-adjusted) for all legs.
  if (transitPreference === 'uber') {
    for (const [key, t] of transitCache) {
      transitCache.set(key, {
        ...t,
        recommended_mode: 'uber',
        recommended_cost_pence: t.uber.mean_pence,
      });
    }
  }

  // ── Enrich combinations ────────────────────────────────────────────────────
  const assembled: AssembledCombination[] = combinations.map((c: any) => {
    const outKey = cacheKey(c.origin_iata, c.outbound_date, c.outbound_departure_time ?? '09:00');
    const retKey = cacheKey(c.ret_dest_iata, c.return_date, c.return_arrival_time ?? '09:00');

    const outTransit = transitCache.get(outKey)!;
    const retTransit = transitCache.get(retKey)!;

    const outTransitGbp = outTransit.recommended_cost_pence / 100;
    const retTransitGbp = retTransit.recommended_cost_pence / 100;
    const transitCostGbp = outTransitGbp + retTransitGbp;

    const totalCostGbp =
      (c.fare_plus_ancillary_gbp ?? 0) +
      transitCostGbp +
      (c.destination_transfer_cost_gbp ?? 0);

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
      cabin_bag_cost_gbp: c.cabin_bag_cost_gbp,
      checked_bag_cost_gbp: c.checked_bag_cost_gbp,
      seat_cost_gbp: c.seat_cost_gbp,
      fare_plus_ancillary_gbp: c.fare_plus_ancillary_gbp,
      destination_transfer_cost_gbp: c.destination_transfer_cost_gbp,
      destination_transfer_known: c.destination_transfer_known,
      requires_absence: c.requires_absence,
      absence_days: c.absence_days,
      fine_gbp: c.fine_gbp,
      outbound_departure_time: c.outbound_departure_time,
      return_arrival_time: c.return_arrival_time,
      is_inset_day: c.is_inset_day,
      baggage_is_estimate: c.baggage_is_estimate,
      family_split_risk: c.family_split_risk,
      split_risk_carriers: c.split_risk_carriers,
      outbound_transit_cost_gbp: outTransitGbp,
      return_transit_cost_gbp: retTransitGbp,
      transit_cost_gbp: transitCostGbp,
      total_cost_gbp: totalCostGbp,
      total_inc_fine: totalIncFine,
      outbound_transit: outTransit,
      return_transit: retTransit,
    };
  });

  // Sort by total_inc_fine ASC
  assembled.sort((a, b) => a.total_inc_fine - b.total_inc_fine);

  // Inset day promotion — if cheapest is not an inset day departure, check whether
  // an inset day combination within £20 exists that requires no absence. If found,
  // promote it to position 0 so it becomes the recommendation.
  const cheapest = assembled[0];
  if (cheapest && !cheapest.is_inset_day) {
    const insetAlternative = assembled.find(c =>
      c.is_inset_day &&
      !c.requires_absence &&
      c.total_inc_fine - cheapest.total_inc_fine <= 20
    );
    if (insetAlternative) {
      const idx = assembled.indexOf(insetAlternative);
      assembled.splice(idx, 1);
      assembled.unshift(insetAlternative);
    }
  }

  // ── Enrich baseline ────────────────────────────────────────────────────────
  const blOutTransit = baseline.outbound_date
    ? transitCache.get(baselineOutKey)!
    : null;
  const blRetTransit = baseline.return_date
    ? transitCache.get(baselineRetKey)!
    : null;

  const blOutTransitGbp = (blOutTransit?.recommended_cost_pence ?? 0) / 100;
  const blRetTransitGbp = (blRetTransit?.recommended_cost_pence ?? 0) / 100;
  const blTransitCostGbp = blOutTransitGbp + blRetTransitGbp;
  const blTotalCostGbp =
    (baseline.fare_plus_ancillary_gbp ?? 0) +
    blTransitCostGbp +
    (baseline.destination_transfer_cost_gbp ?? 0);

  const assembledBaseline: AssembledBaseline = {
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
    outbound_departure_time: baseline.outbound_departure_time ?? null,
    baseline_is_fallback: baseline.baseline_is_fallback,
    baseline_airport: nearestAirport,
    outbound_transit_cost_gbp: blOutTransitGbp,
    return_transit_cost_gbp: blRetTransitGbp,
    transit_cost_gbp: blTransitCostGbp,
    total_cost_gbp: blTotalCostGbp,
    outbound_transit: blOutTransit,
    return_transit: blRetTransit,
  };

  // ── Saving category ────────────────────────────────────────────────────────
  const saving = assembledBaseline.total_cost_gbp - assembled[0].total_cost_gbp;
  const savingCategory: 'significant' | 'modest' | 'minimal' | 'baseline_cheapest' =
    saving >= 75 ? 'significant' :
    saving >= 20 ? 'modest' :
    saving >= 0  ? 'minimal' :
                   'baseline_cheapest';

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
    recommendation: assembled[0],
    savingCategory,
    baselineIsRecommended,
    baselineAsItinerary,
  };
}
