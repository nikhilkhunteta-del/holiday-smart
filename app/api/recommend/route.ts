import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabase-server';
import { assembleCombinationsOnly, buildAssemblyPrecomputed } from '@/lib/flights/assembleRecommendation';
import { getAIRecommendation } from '@/lib/flights/getAIRecommendation';
import { effectiveCost, viable } from '@/lib/flights/selectCombination';
import { buildScenarioResults } from '@/lib/flights/buildScenarioResults';
import { combinationKey } from '@/lib/flights/buildCandidates';
import { computePriceMovement, type PriceMovementRaw } from '@/lib/flights/priceMovement';

function fmtDateLong(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const dayName = d.toLocaleDateString('en-GB', { weekday: 'long' });
  return `${dayName} ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Schools don't resume on a weekend — if window_end + 1 lands on Saturday
// or Sunday, roll forward to the following Monday.
function nextWeekday(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

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

    // Price history for this exact itinerary — fired now, awaited later
    // (right before the getAIRecommendation call) so it runs concurrently
    // with the scenario/selection work below instead of adding serial
    // latency. Both legs must match on origin/destination/date/carrier +
    // party composition — flight_number is NULL for every fare_snapshots
    // row, so it's never part of the match.
    //
    // Airport field mapping (verified against assembleRecommendation.ts:717
    // and get_smart_recommendation.sql — ret_dest_iata is the LONDON arrival
    // airport for the return leg, NOT the abroad airport; origin_iata is the
    // OUTBOUND'S OWN London departure airport and can differ from the
    // return's London arrival airport in asymmetric multi-airport combos).
    // ret_orig_iata is the return leg's own abroad departure airport — a
    // destination can have multiple abroad airports in its pool (e.g.
    // Barcelona: BCN, GRO, Reus) and nearby-airport arbitrage can pick a
    // different one for the return leg than the outbound, even for
    // non-circuit destinations — so this is never approximated from
    // out_dest_iata, read directly from the RPC instead:
    //   outbound: origin_iata      (London,  outbound departure)
    //             → out_dest_iata  (abroad,  outbound arrival)
    //   return:   ret_orig_iata    (abroad,  return departure)
    //             → ret_dest_iata  (London,  return arrival)
    const priceMovementPromise = supabase.rpc('get_price_movement', {
      p_out_origin_iata:  recommendation.origin_iata,
      p_out_dest_iata:    recommendation.out_dest_iata,
      p_ret_origin_iata:  recommendation.ret_orig_iata,
      p_ret_dest_iata:    recommendation.ret_dest_iata,
      p_outbound_date:    recommendation.outbound_date,
      p_return_date:      recommendation.return_date,
      p_outbound_carrier: recommendation.outbound_carrier,
      p_return_carrier:   recommendation.return_carrier,
      p_adults:           adults,
      p_children:         children,
      p_infants:          infants,
    });

    // ── TEMP DIAGNOSTIC — remove once the checks_with_data=0 report is
    // confirmed/resolved. Logs the exact identity get_price_movement is
    // matching on, plus whatever fare_snapshots actually holds for that
    // route/date/carrier with NO composition filter — so a composition
    // mismatch (get_smart_recommendation maps to the nearest of 4 fixed
    // compositions; this route was passing the raw requested party) shows
    // up directly in the logs instead of being inferred.
    const priceMovementDebugPromise = Promise.all([
      supabase.from('fare_snapshots')
        .select('run_id, adults, children, infants, party_total_gbp, observed_at')
        .eq('origin_iata', recommendation.origin_iata)
        .eq('destination_iata', recommendation.out_dest_iata)
        .eq('departure_date', recommendation.outbound_date)
        .eq('airline_iata', recommendation.outbound_carrier)
        .order('observed_at', { ascending: false })
        .limit(20),
      supabase.from('fare_snapshots')
        .select('run_id, adults, children, infants, party_total_gbp, observed_at')
        .eq('origin_iata', recommendation.ret_orig_iata)
        .eq('destination_iata', recommendation.ret_dest_iata)
        .eq('departure_date', recommendation.return_date)
        .eq('airline_iata', recommendation.return_carrier)
        .order('observed_at', { ascending: false })
        .limit(20),
    ]).then(([outboundRows, returnRows]) => {
      console.log('[price-movement-debug] identity being matched:', {
        outbound: {
          origin_iata: recommendation.origin_iata,
          destination_iata: recommendation.out_dest_iata,
          departure_date: recommendation.outbound_date,
          airline_iata: recommendation.outbound_carrier,
        },
        return: {
          origin_iata: recommendation.ret_orig_iata,
          destination_iata: recommendation.ret_dest_iata,
          departure_date: recommendation.return_date,
          airline_iata: recommendation.return_carrier,
        },
        party_used_by_this_route: { adults, children, infants },
      });
      console.log('[price-movement-debug] outbound rows actually in fare_snapshots for that route/date/carrier (any composition, any run):',
        outboundRows.error ?? outboundRows.data);
      console.log('[price-movement-debug] return rows actually in fare_snapshots for that route/date/carrier (any composition, any run):',
        returnRows.error ?? returnRows.data);
    });

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
    // Rounded to whole pounds at the point of computation — total_cost_gbp
    // arrives from the RPC as a float (fee components sum with IEEE 754
    // rounding error), so any arithmetic on the raw value propagates that
    // error downstream (e.g. netCost showing as £760.0599999999999). Round
    // each input before combining them, not just the final display figure.
    const baselineAllin = Math.round(assembled.baseline?.total_cost_gbp ?? 0);
    const winnerTotal    = Math.round(recommendation.total_cost_gbp);
    const fineGbp        = Math.round(recommendation.fine_gbp ?? 0);
    const absenceDays    = recommendation.absence_days ?? 0;
    const absenceOutDays = recommendation.absence_out_days ?? 0;
    const absenceRetDays = recommendation.absence_ret_days ?? 0;
    const savingVsBaseline = baselineAllin - winnerTotal;
    const fineWipesSaving  = absenceDays > 0 && fineGbp > savingVsBaseline;
    const netCost  = Math.round(winnerTotal + fineGbp);
    const netDelta = netCost - baselineAllin; // positive = net worse off vs baseline
    const termResumeDate = windowEnd ? fmtDateLong(nextWeekday(addDays(windowEnd, 1))) : '';

    // ── Best alternative that avoids the fine (or just the runner-up) ──────
    const winnerCombinationKey = combinationKey(recommendation);
    const alternatives = assembled.scoredPool
      .filter(c =>
        !(c as any).is_baseline &&
        combinationKey(c) !== winnerCombinationKey &&
        (absenceDays > 0 ? c.absence_days === 0 : true),
      )
      .sort((a, b) => effectiveCost(a) - effectiveCost(b));
    const bestNoFineAlternative = alternatives[0] ?? null;

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

    // ── Quality context for the "why this over the alternatives" card ──────
    // selectionContext.winner (ScoredCombination) carries the quality fields
    // that assembled.recommendation's AssembledCombination type doesn't —
    // same underlying object.
    const winnerScored = selectionContext.winner;
    const winnerOutDepTime    = winnerScored.outbound_departure_time?.toString().slice(0, 5) ?? '';
    const winnerOutDepQuality = winnerScored.outbound_departure_quality ?? '';
    const winnerArrTime       = winnerScored.outbound_arrival_time?.toString().slice(0, 5) ?? '';
    const winnerArrQuality    = winnerScored.arrival_quality ?? '';
    const winnerRetDepTime    = winnerScored.return_departure_time?.toString().slice(0, 5) ?? '';
    const winnerRetDepQuality = winnerScored.return_departure_quality ?? '';

    const baselineOutDepTime    = bl?.outbound_departure_time?.toString().slice(0, 5) ?? undefined;
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

    await priceMovementDebugPromise;
    const priceMovementResult = await priceMovementPromise;
    if (priceMovementResult.error) {
      console.error('[api/recommend] get_price_movement RPC failed:', priceMovementResult.error);
    }
    const priceMovementRaw: PriceMovementRaw = priceMovementResult.data ?? {
      checks_total: 0,
      checks_with_data: 0,
      price_points: [],
    };
    const priceMovement = computePriceMovement(priceMovementRaw);

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
      lcc_cabin_bag_min_fee: lccCabinBagFees.min,
      lcc_cabin_bag_max_fee: lccCabinBagFees.max,
      partySize,
      price_checks_total:       priceMovementRaw.checks_total,
      price_checks_with_data:   priceMovementRaw.checks_with_data,
      price_points:             priceMovementRaw.price_points,
      price_latest_total_gbp:   priceMovement.latest_total_gbp,
      price_previous_total_gbp: priceMovement.previous_total_gbp,
      price_delta_gbp:          priceMovement.delta_gbp,
      price_direction:          priceMovement.direction,
      price_first_checked_on:   priceMovement.first_checked_on,
      price_first_total_gbp:    priceMovement.first_total_gbp,
      price_total_change_gbp:   priceMovement.total_change_gbp,
      destinationName: destinationSlug
        .split('-')
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
      transitPreference,
      scenarios,
      savingCategory: body.savingCategory ?? 'found_saving',
      combinationCount: body.combinationCount ?? 0,
      distinctDatePairs: body.distinctDatePairs ?? 0,
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
