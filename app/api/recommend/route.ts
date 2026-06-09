import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabase-server';
import { assembleCombinationsOnly } from '@/lib/flights/assembleRecommendation';
import { getAIRecommendation } from '@/lib/flights/getAIRecommendation';

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
      benchmarkCost: assembled.benchmark,
    });

    // Return AI result plus the recommended combination index
    // mapped back to the full combinations array
    return NextResponse.json({
      ...aiResult,
      // Include the full recommended combination so client can
      // identify OUR PICK in matrix and leg tables
      recommendedCombination: assembled.shortlist[aiResult.recommended_index] ?? null,
    });

  } catch (err) {
    console.error('[api/recommend] error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
