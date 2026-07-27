import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabase-server';
import { computePriceMovement, type PriceMovementRaw } from '@/lib/flights/priceMovement';
import { narratePriceMovement } from '@/lib/flights/priceMovementNarration';

// Destination-level median airfare history — powers the "How {destination}
// prices have moved" card below the date matrix. Reads get_destination_median_history,
// which itself reads the destination_median_history cache table (never a
// live fare_snapshots scan) filtered by get_valid_history_run_ids().
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const destinationSlug = sp.get('destination_slug');
  const tripType        = sp.get('trip_type');
  const adultsStr       = sp.get('adults');
  const childrenStr     = sp.get('children');
  const infantsStr      = sp.get('infants');

  if (!destinationSlug || !tripType || !adultsStr || !childrenStr || !infantsStr) {
    return NextResponse.json(
      { error: 'Missing required parameters: destination_slug, trip_type, adults, children, infants' },
      { status: 400 },
    );
  }

  const adults   = Number(adultsStr);
  const children = Number(childrenStr);
  const infants  = Number(infantsStr);

  const result = await supabase.rpc('get_destination_median_history', {
    p_destination_slug: destinationSlug,
    p_trip_type:        tripType,
    p_adults:           adults,
    p_children:         children,
    p_infants:          infants,
  });

  if (result.error) {
    console.error('[api/destination-price-history] get_destination_median_history RPC failed:', result.error);
    return NextResponse.json({ error: 'Supabase RPC failed', details: result.error }, { status: 500 });
  }

  const raw: PriceMovementRaw = result.data ?? { checks_total: 0, checks_with_data: 0, price_points: [] };
  const computed = computePriceMovement(raw);
  // This series is a median across every date pair on the matrix — not
  // tied to one flight or even one date pair. "this exact flight" (the
  // default) would be wrong here for the same reason it was wrong on the
  // per-cell card, only more so. Naming it "the median fare" (rather than
  // "the typical fare") in the subject_label itself, matching the
  // subtitle's explicit "(the median)" — see priceMovementNarration.ts's
  // rule 6 for why the narration must say "the median fare... has
  // fallen", never "the price has fallen", for this series specifically.
  const narration = await narratePriceMovement({ ...raw, ...computed }, 'the median fare across this destination');

  return NextResponse.json({
    checks_total:     raw.checks_total,
    checks_with_data: raw.checks_with_data,
    price_points:     raw.price_points,
    ...computed,
    narration,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
