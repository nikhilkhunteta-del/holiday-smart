import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabase-server';
import { assembleCombinationsOnly } from '@/lib/flights/assembleRecommendation';
import { getAIRecommendation } from '@/lib/flights/getAIRecommendation';
import { effectiveCost, viable } from '@/lib/flights/selectCombination';
import { computeScenarios } from '@/lib/flights/computeScenarios';

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

    const assembled = await assembleCombinationsOnly(
      smartResult.data,
      postcodeDistrict,
      adults,
      children,
      infants,
      transitPreference,
    );

    // Canonical winner — computed once inside assembleCombinationsOnly over the
    // full deduped pool, not the AI-facing shortlist. Do not recompute here:
    // a second selectCombination(assembled.shortlist) call would silently
    // diverge from assembled.recommendation once the pools differ.
    const selectionContext = assembled.selection;
    if (!selectionContext) {
      return NextResponse.json({ fallback: true }, { status: 200 });
    }

    // Compute what-if scenarios using full assembled combinations
    const currentWinner = assembled.combinations.find(c =>
      c.outbound_date    === selectionContext.winner.outbound_date &&
      c.return_date      === selectionContext.winner.return_date   &&
      c.outbound_carrier === selectionContext.winner.outbound_carrier,
    ) ?? assembled.combinations[0];

    const scenarios = currentWinner
      ? computeScenarios(
          assembled.combinations,
          currentWinner,
          transitPreference,
          adults,
          children,
          cabinBags,
          checkedBags,
          seatsTogether,
        )
      : [];

    const combinations = assembled.shortlist;
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
      destinationName: destinationSlug
        .split('-')
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
      transitPreference,
      scenarios,
      savingCategory: body.savingCategory ?? 'modest',
      combinationCount: body.combinationCount ?? 0,
    }, selectionContext);

    return NextResponse.json({
      ...aiResult,
      winner_outbound_date:    selectionContext.winner.outbound_date,
      winner_return_date:      selectionContext.winner.return_date,
      winner_outbound_carrier: selectionContext.winner.outbound_carrier,
    });

  } catch (err) {
    console.error('[api/recommend] error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
