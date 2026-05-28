import { supabaseServer as supabase } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: {
    urn?: string;
    start?: string;
    end?: string;
    adults?: string;
    children?: string;
    infants?: string;
    tripStyle?: string;
    school?: string;
    borough?: string;
    break?: string;
  };
}

export default async function FlightInsightsPage({ searchParams }: PageProps) {
  const urn         = searchParams.urn;
  const windowStart = searchParams.start;
  const windowEnd   = searchParams.end;
  const adults      = Number(searchParams.adults   ?? 2);
  const children    = Number(searchParams.children ?? 0);
  const infants     = Number(searchParams.infants  ?? 0);
  const tripStyle   = searchParams.tripStyle; // 'circuit' | 'base'

  // TEMP: hardcoded to 4 until destination type drives this
  const tripDurationNights = 4;

  // TEMP: hardcoded until leaderboard passes destination slug
  const destinationSlug = 'barcelona';

  if (!urn || !windowStart || !windowEnd) {
    return (
      <div style={{ padding: 24, fontFamily: 'Inter, sans-serif' }}>
        <strong>Missing required parameters:</strong> urn, start, and end are all required.
        <pre style={{ marginTop: 12, fontSize: 12 }}>
          {JSON.stringify({ urn, windowStart, windowEnd }, null, 2)}
        </pre>
      </div>
    );
  }

  // ── Wave 1: savings breakdown + compliance (no date dependencies) ──────────
  const [savingsResult, complianceResult] = await Promise.all([
    supabase.rpc('get_savings_breakdown', {
      p_destination_slug:     destinationSlug,
      p_school_urn:           urn,
      p_window_start:         windowStart,
      p_window_end:           windowEnd,
      p_trip_duration_nights: tripDurationNights,
      p_adults:               adults,
      p_children:             children,
      p_infants:              infants,
    }),
    supabase.rpc('get_compliance_scenarios', {
      p_destination_slug: destinationSlug,
      p_school_urn:       urn,
      p_adults:           adults,
      p_children:         children,
      p_infants:          infants,
    }),
  ]);

  if (savingsResult.error || !savingsResult.data) {
    return (
      <div style={{ padding: 24, fontFamily: 'Inter, sans-serif' }}>
        <strong>Savings breakdown failed.</strong>
        <pre style={{ marginTop: 12, fontSize: 12 }}>
          {JSON.stringify({ error: savingsResult.error, data: savingsResult.data }, null, 2)}
        </pre>
      </div>
    );
  }

  // ── Extract optimal dates from Wave 1 ─────────────────────────────────────
  const savingsData      = savingsResult.data as any;
  const bestOutboundDate = savingsData?.best_outbound_date as string | undefined;
  const bestReturnDate   = savingsData?.best_return_date   as string | undefined;

  const airportLever   = savingsData?.levers?.find(
    (l: any) => l.label?.startsWith('London airport')
  );
  const bestOriginIata = airportLever?.winner ?? 'LHR';

  if (!bestOutboundDate || !bestReturnDate) {
    console.error('[FlightInsights] best_outbound_date or best_return_date missing. savingsResult.data shape:', JSON.stringify(savingsResult.data, null, 2));
    return (
      <div style={{ padding: 24, fontFamily: 'Inter, sans-serif' }}>
        <strong>Could not extract optimal dates from savings breakdown.</strong>
        <pre style={{ marginTop: 12, fontSize: 12 }}>
          {JSON.stringify(savingsResult.data, null, 2)}
        </pre>
      </div>
    );
  }

  // ── Wave 2: all remaining RPC calls in parallel ────────────────────────────
  const [
    allinResult,
    multiAirportResult,
    bucketSplitResult,
    openJawResult,
    nearbyAirportsResult,
  ] = await Promise.all([
    supabase.rpc('get_allin_flight_cost', {
      p_destination_slug: destinationSlug,
      p_school_urn:       urn,
      p_outbound_date:    bestOutboundDate,
      p_return_date:      bestReturnDate,
      p_adults:           adults,
      p_children:         children,
      p_infants:          infants,
      p_transport_mode:   'public_transport',
    }),
    supabase.rpc('get_multi_airport', {
      p_destination_slug: destinationSlug,
      p_school_urn:       urn,
      p_outbound_date:    bestOutboundDate,
      p_return_date:      bestReturnDate,
      p_adults:           adults,
      p_children:         children,
      p_infants:          infants,
    }),
    supabase.rpc('get_bucket_split', {
      p_destination_slug: destinationSlug,
      p_origin_iata:      bestOriginIata,
      p_outbound_date:    bestOutboundDate,
      p_return_date:      bestReturnDate,
      p_adults:           adults,
      p_children:         children,
      p_infants:          infants,
    }),
    supabase.rpc('get_open_jaw', {
      p_destination_slug: destinationSlug,
      p_school_urn:       urn,
      p_outbound_date:    bestOutboundDate,
      p_return_date:      bestReturnDate,
      p_adults:           adults,
      p_children:         children,
      p_infants:          infants,
    }),
    supabase.rpc('get_nearby_destination_airports', {
      p_destination_slug: destinationSlug,
      p_school_urn:       urn,
      p_outbound_date:    bestOutboundDate,
      p_return_date:      bestReturnDate,
      p_adults:           adults,
      p_children:         children,
      p_infants:          infants,
    }),
  ]);

  // Wave 2 errors are non-fatal — null means that section won't render
  return (
    <pre style={{ padding: 24, fontSize: 12 }}>
      {JSON.stringify({
        savings:       savingsResult.data,
        compliance:    complianceResult.data,
        allin:         allinResult.data,
        multiAirport:  multiAirportResult.data,
        bucketSplit:   bucketSplitResult.data,
        openJaw:       openJawResult.data,
        nearbyAirports: nearbyAirportsResult.data,
      }, null, 2)}
    </pre>
  );
}
