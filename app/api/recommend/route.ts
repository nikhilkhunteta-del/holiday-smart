import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabase-server';
import { assembleCombinationsOnly } from '@/lib/flights/assembleRecommendation';
import { getAIRecommendation } from '@/lib/flights/getAIRecommendation';
import { selectCombination } from '@/lib/flights/selectCombination';

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

    const selectionContext = selectCombination(assembled.shortlist);
    if (!selectionContext) {
      return NextResponse.json({ fallback: true }, { status: 200 });
    }

    const combinations = assembled.shortlist;
    console.log('[validate] top combinations:',
      JSON.stringify(
        combinations
          .filter(c => !c.requires_absence)
          .sort((a, b) => a.total_cost_gbp - b.total_cost_gbp)
          .slice(0, 10)
          .map(c => ({
            out: c.outbound_date,
            ret: c.return_date,
            nights: c.trip_nights,
            inset: c.is_inset_day,
            cost: Math.round(c.total_cost_gbp),
            arr_q: c.arrival_quality,
            out_dep_q: c.outbound_departure_quality,
            ret_dep_q: c.return_departure_quality,
            transit_changes: c.outbound_transit?.transit?.changes ?? null,
            eff_cost: Math.round(
              c.total_cost_gbp
              - (80 * c.trip_nights)
              - (c.is_inset_day ? 30 : 0)
              + (({excellent:0,good:15,acceptable:40} as Record<string,number>)[c.arrival_quality ?? ''] ?? 40)
              + (({ideal:0,good:10,very_early:35} as Record<string,number>)[c.outbound_departure_quality ?? ''] ?? 35)
              + (({excellent:0,good:10,early:25,very_early:35} as Record<string,number>)[c.return_departure_quality ?? ''] ?? 35)
              + (10 * Math.max(0, (c.outbound_transit?.transit?.changes ?? 0) - 1))
            ),
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
    }, selectionContext);

    console.log('[route] recommended_index being returned:', aiResult.recommended_index);
    console.log('[route] combination at that index:',
      JSON.stringify({
        out: combinations[aiResult.recommended_index]?.outbound_date,
        ret: combinations[aiResult.recommended_index]?.return_date,
        carrier: combinations[aiResult.recommended_index]?.outbound_carrier,
      })
    );

    return NextResponse.json({
      ...aiResult,
      recommended_index:       aiResult.recommended_index,
      winner_outbound_date:    selectionContext.winner.outbound_date,
      winner_return_date:      selectionContext.winner.return_date,
      winner_outbound_carrier: selectionContext.winner.outbound_carrier,
      recommendedCombination: assembled.shortlist[aiResult.recommended_index] ?? null,
    });

  } catch (err) {
    console.error('[api/recommend] error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
