import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabase-server';
import { computePriceMovement, narratePriceMovement, type PriceMovementRaw } from '@/lib/flights/priceMovement';

// Per-cell airfare history for one exact date pair — powers the per-cell
// history chart below the date matrix, which defaults to the current
// recommendation's date pair and updates on matrix cell click. Reads
// get_cell_price_history, which itself reads the cell_price_history cache
// table (never a live fare_snapshots scan) filtered by
// get_valid_history_run_ids().
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const destinationSlug = sp.get('destination_slug');
  const tripType        = sp.get('trip_type');
  const adultsStr       = sp.get('adults');
  const childrenStr     = sp.get('children');
  const infantsStr      = sp.get('infants');
  const departureDate   = sp.get('departure_date');
  const returnDate      = sp.get('return_date');

  if (!destinationSlug || !tripType || !adultsStr || !childrenStr || !infantsStr || !departureDate || !returnDate) {
    return NextResponse.json(
      { error: 'Missing required parameters: destination_slug, trip_type, adults, children, infants, departure_date, return_date' },
      { status: 400 },
    );
  }

  const adults   = Number(adultsStr);
  const children = Number(childrenStr);
  const infants  = Number(infantsStr);

  const result = await supabase.rpc('get_cell_price_history', {
    p_destination_slug: destinationSlug,
    p_trip_type:        tripType,
    p_adults:           adults,
    p_children:         children,
    p_infants:          infants,
    p_departure_date:   departureDate,
    p_return_date:      returnDate,
  });

  if (result.error) {
    console.error('[api/cell-price-history] get_cell_price_history RPC failed:', result.error);
    return NextResponse.json({ error: 'Supabase RPC failed', details: result.error }, { status: 500 });
  }

  const raw: PriceMovementRaw = result.data ?? { checks_total: 0, checks_with_data: 0, price_points: [] };
  const computed = computePriceMovement(raw);
  // This series is the cheapest fare for one exact date pair, independently
  // recomputed across the whole airport pool/any carrier at each check — it
  // is NOT guaranteed to be the same flight throughout its history. "these
  // exact dates" is correct here; "this exact flight" (the default) is not.
  const narration = await narratePriceMovement({ ...raw, ...computed }, 'these exact dates');

  return NextResponse.json({
    checks_total:     raw.checks_total,
    checks_with_data: raw.checks_with_data,
    price_points:     raw.price_points,
    ...computed,
    narration,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
