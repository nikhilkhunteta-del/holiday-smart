import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabase-server';
import { assembleCombinationsOnly, buildAssemblyPrecomputed } from '@/lib/flights/assembleRecommendation';
import { getAIRecommendation } from '@/lib/flights/getAIRecommendation';
import { effectiveCost, viable } from '@/lib/flights/selectCombination';
import { buildScenarioResults } from '@/lib/flights/buildScenarioResults';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      destinationSlug,
      schoolUrn,
      tripType,
      adults,
      children,
      infants,
      cabinBags,
      checkedBags,
      seatsTogether,
      transitPreference,
      windowStart,
      windowEnd,
      postcodeDistrict,
      schoolName,
      borough,
    } = body;

    const [smartResult] = await Promise.all([
      supabase.rpc('get_smart_recommendation', {
        p_destination_slug: destinationSlug,
        p_school_urn:       schoolUrn,
        p_trip_type:        tripType,
        p_adults:           adults,
        p_children:         children,
        p_infants:          infants,
        p_cabin_bags:       cabinBags,
        p_checked_bags:     checkedBags,
        p_seats_together:   seatsTogether,
      }),
    ]);

    if (smartResult.error || !smartResult.data) {
      return NextResponse.json({ error: 'RPC failed' }, { status: 500 });
    }

    const smartRaw = smartResult.data;
    const rawCombinations = smartRaw?.combinations ?? [];
    const rawBaseline = smartRaw?.baseline ?? {};

    // Build shared precomputed cache — airport + transit + bag fees
    const precomputed = await buildAssemblyPrecomputed(
      rawCombinations, rawBaseline, postcodeDistrict,
      adults, children, infants, cabinBags, checkedBags,
    );
    const airportOnly = { nearestAirport: precomputed.nearestAirport,
      bagFeesCache: precomputed.bagFeesCache,
      originalCabinBags: cabinBags, originalCheckedBags: checkedBags };

    // Main assembly + 4 scenario re-assemblies in parallel
    const [assembled, scenarioLightResult, scenarioCheckedResult, scenarioUberResult, scenarioTransitResult] =
      await Promise.all([
        assembleCombinationsOnly(
          smartRaw, postcodeDistrict, adults, children, infants,
          transitPreference, cabinBags, checkedBags, seatsTogether, precomputed,
        ),
        assembleCombinationsOnly(
          smartRaw, postcodeDistrict, adults, children, infants,
          transitPreference, 0, 0, seatsTogether, airportOnly,
        ),
        assembleCombinationsOnly(
          smartRaw, postcodeDistrict, adults, children, infants,
          transitPreference, cabinBags, checkedBags + 1, seatsTogether, airportOnly,
        ),
        transitPreference !== 'uber'
          ? assembleCombinationsOnly(
              smartRaw, postcodeDistrict, adults, children, infants,
              'uber', cabinBags, checkedBags, seatsTogether, precomputed,
            )
          : assembleCombinationsOnly(
              smartRaw, postcodeDistrict, adults, children, infants,
              'auto', cabinBags, checkedBags, seatsTogether, precomputed,
            ),
        transitPreference !== 'transit'
          ? assembleCombinationsOnly(
              smartRaw, postcodeDistrict, adults, children, infants,
              'transit', cabinBags, checkedBags, seatsTogether, precomputed,
            )
          : null,
      ]);

    const selectionContext = assembled.selection;
    if (!selectionContext) {
      return NextResponse.json({ fallback: true }, { status: 200 });
    }

    const recommendation = assembled.recommendation;

    console.log('[api-route] recommendation dest fields:', {
      destination_transit_notes: recommendation.destination_transit_notes,
      destination_transfer_is_taxi: recommendation.destination_transfer_is_taxi,
      destination_taxi_cost_low_gbp: recommendation.destination_taxi_cost_low_gbp,
      destination_taxi_cost_high_gbp: recommendation.destination_taxi_cost_high_gbp,
    });

    const scenarios = buildScenarioResults(
      recommendation, assembled,
      { light: scenarioLightResult, checked: scenarioCheckedResult,
        uber: scenarioUberResult, seats: null, transit: scenarioTransitResult },
      { cabinBags, checkedBags, seatsTogether, transitPreference, adults,
        destinationName: destinationSlug?.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        firstCheckedBagGbp: precomputed.bagFeesCache?.get(recommendation?.outbound_carrier ?? 'BA')?.first_checked_bag_gbp ?? undefined,
      },
    );

    const combinations = assembled.scoredPool;
    console.log('[validate] top combinations:',
      JSON.stringify(
        combinations
          .filter(c => !c.requires_absence)
          .sort((a, b) => effectiveCost(a) - effectiveCost(b))
          .slice(0, 10)
          .map(c => ({
            out: c.outbound_date,
            ret: c.return_date,
            nights: c.trip_nights,
            inset: c.is_inset_day,
            viable: viable(c),
            cost: Math.round(c.total_cost_gbp),
            arr_q: c.arrival_quality,
            out_dep_q: c.outbound_departure_quality,
            ret_dep_q: c.return_departure_quality,
            transit_changes: c.outbound_transit?.transit?.changes ?? null,
            eff_cost: Math.round(effectiveCost(c)),
          })),
        null, 2
      )
    );

    console.log('[validate] winner:',
      JSON.stringify({
        out: selectionContext.winner.outbound_date,
        ret: selectionContext.winner.return_date,
        nights: selectionContext.winner.trip_nights,
        cost: Math.round(selectionContext.winner.total_cost_gbp),
        eff_cost: Math.round(selectionContext.winnerEffCost),
      })
    );

    const blScored = assembled.scoredPool.find(c => (c as any).is_baseline) ?? null;
    const bl = assembled.baselineAsCombination;
    const partySize = adults + children;
    const lccCabinBagFees = (() => {
      if (!precomputed.bagFeesCache) return { min: undefined, max: undefined };
      const fees: number[] = [];
      for (const [, row] of precomputed.bagFeesCache) {
        if (!row.cabin_bag_included && row.full_cabin_bag_fee_gbp != null && row.full_cabin_bag_fee_gbp > 0) {
          fees.push(row.full_cabin_bag_fee_gbp);
        }
      }
      if (fees.length === 0) return { min: undefined, max: undefined };
      return { min: Math.min(...fees), max: Math.max(...fees) };
    })();
    const bestInsetFromPool = (() => {
      const insets = assembled.scoredPool
        .filter(c => c.is_inset_day && !(c as any).is_baseline)
        .sort((a, b) => effectiveCost(a) - effectiveCost(b));
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
    })();

    // ── Fine/absence-aware saving fields ────────────────────────────────────
    const baselineAllin = assembled.baseline?.total_cost_gbp ?? 0;
    const winnerTotal    = recommendation.total_cost_gbp;
    const fineGbp        = recommendation.fine_gbp ?? 0;
    const absenceDays    = recommendation.absence_days ?? 0;
    const savingVsBaseline = baselineAllin - winnerTotal;
    const fineWipesSaving  = absenceDays > 0 && fineGbp > savingVsBaseline;
    const netCost  = winnerTotal + fineGbp;
    const netDelta = netCost - baselineAllin; // positive = net worse off vs baseline

    const aiResult = await getAIRecommendation(assembled.shortlist, {
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
      benchmarkCost: assembled.baseline?.total_cost_gbp ?? null,
      baseline_fare:  Math.round(assembled.baseline?.baseline_fare_gbp ?? 0),
      baseline_allin: Math.round(assembled.baseline?.total_cost_gbp ?? 0),
      baseline_airport_name: ({ LHR: 'Heathrow', LGW: 'Gatwick', STN: 'Stansted', LTN: 'Luton', LCY: 'City', SEN: 'Southend' } as Record<string, string>)[assembled.baseline?.baseline_airport ?? 'LHR'] ?? assembled.baseline?.baseline_airport ?? 'Heathrow',
      baseline_arr_quality:     blScored?.arrival_quality ?? undefined,
      baseline_ret_dep_quality: blScored?.return_departure_quality ?? undefined,
      baseline_out_dep_quality: blScored?.outbound_departure_quality ?? undefined,
      baseline_out_arr_time:    bl?.outbound_arrival_time ?? undefined,
      baseline_ret_dep_time:    bl?.return_departure_time ?? undefined,
      baseline_ret_arr_time:    bl?.return_arrival_time ?? undefined,
      baseline_origin_iata:     bl?.origin_iata ?? undefined,
      baseline_dest_iata:       bl?.out_dest_iata ?? undefined,
      baseline_outbound_date:   bl?.outbound_date ?? undefined,
      baseline_return_date:     bl?.return_date ?? undefined,
      baseline_trip_nights:     blScored?.trip_nights ?? undefined,
      baseline_carrier:         bl?.outbound_carrier ?? undefined,
      bestInsetFromPool,
      absence_days:        absenceDays,
      fine_gbp:             fineGbp,
      fine_wipes_saving:    fineWipesSaving,
      net_cost_with_fine:   netCost,
      net_delta_with_fine:  netDelta,
      lcc_cabin_bag_min_fee: lccCabinBagFees.min,
      lcc_cabin_bag_max_fee: lccCabinBagFees.max,
      partySize,
      destinationName: destinationSlug
        .split('-')
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
      transitPreference,
      scenarios,
      savingCategory: body.savingCategory ?? 'found_saving',
      combinationCount: body.combinationCount ?? 0,
    }, selectionContext, assembled.scoredPool);

    return NextResponse.json({
      ...aiResult,
      winner_absence_days:     selectionContext.winner.absence_days,
      winner_fine_gbp:         selectionContext.winner.fine_gbp,
      winner_fine_wipes_saving: fineWipesSaving,
      winner_outbound_date:    selectionContext.winner.outbound_date,
      winner_return_date:      selectionContext.winner.return_date,
      winner_outbound_carrier: selectionContext.winner.outbound_carrier,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });

  } catch (err) {
    console.error('[api/recommend] error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
