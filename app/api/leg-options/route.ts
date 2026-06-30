import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabase-server';
import { attachTransitCost } from '@/lib/flights/attachTransitCost';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const destinationSlug = sp.get('destination_slug');
  const schoolUrn       = sp.get('school_urn');
  const outboundDate    = sp.get('outbound_date');
  const returnDate      = sp.get('return_date');
  const adultsStr       = sp.get('adults');
  const childrenStr     = sp.get('children');
  const infantsStr      = sp.get('infants');
  const cabinBagsStr    = sp.get('cabin_bags');
  const checkedBagsStr  = sp.get('checked_bags');
  const seatsStr        = sp.get('seats_together');
  const transportMode   = sp.get('transport_mode') ?? 'auto';

  if (!destinationSlug || !schoolUrn || !outboundDate || !returnDate || !adultsStr || !childrenStr || !infantsStr) {
    return NextResponse.json(
      { error: 'Missing required parameters: destination_slug, school_urn, outbound_date, return_date, adults, children, infants' },
      { status: 400 },
    );
  }

  const adults        = Number(adultsStr);
  const children      = Number(childrenStr);
  const infants       = Number(infantsStr);
  const cabinBags     = Number(cabinBagsStr ?? String(adults));
  const checkedBags   = Number(checkedBagsStr ?? '0');
  const seatsTogether = seatsStr === 'true';
  const transitPreference = (transportMode === 'uber' ? 'uber' : transportMode === 'transit' ? 'transit' : 'auto') as 'auto' | 'uber' | 'transit';

  const schoolResult = await supabase
    .from('all_schools')
    .select('postcode_district')
    .eq('urn', schoolUrn)
    .maybeSingle();

  const postcodeDistrict = (schoolResult.data as any)?.postcode_district ?? 'SW1A';

  const [outboundLegResult, returnLegResult] = await Promise.all([
    supabase.rpc('get_leg_options', {
      p_destination_slug: destinationSlug,
      p_school_urn:       schoolUrn,
      p_date:             outboundDate,
      p_direction:        'outbound',
      p_adults:           adults,
      p_children:         children,
      p_infants:          infants,
      p_cabin_bags:       cabinBags,
      p_checked_bags:     checkedBags,
      p_seats_together:   seatsTogether,
    }),
    supabase.rpc('get_leg_options', {
      p_destination_slug: destinationSlug,
      p_school_urn:       schoolUrn,
      p_date:             returnDate,
      p_direction:        'return',
      p_adults:           adults,
      p_children:         children,
      p_infants:          infants,
      p_cabin_bags:       cabinBags,
      p_checked_bags:     checkedBags,
      p_seats_together:   seatsTogether,
    }),
  ]);

  if (outboundLegResult.error || returnLegResult.error) {
    return NextResponse.json(
      { error: 'Supabase RPC failed', details: { outbound: outboundLegResult.error, return: returnLegResult.error } },
      { status: 500 },
    );
  }

  const outbound = attachTransitCost(
    outboundLegResult, 'outbound', outboundDate, postcodeDistrict,
    adults, children, infants, checkedBags, transitPreference,
  );
  const returnData = attachTransitCost(
    returnLegResult, 'return', returnDate, postcodeDistrict,
    adults, children, infants, checkedBags, transitPreference,
  );

  return NextResponse.json({ outbound, return: returnData });
}
