import { supabaseServer as supabase } from '@/lib/supabase-server';
import { SavingsBreakdown } from '@/components/flight-insights/savings-breakdown';
import { ComplianceCalculator } from '@/components/flight-insights/compliance-calculator';
import { AllInCost } from '@/components/flight-insights/all-in-cost';
import { assembleRecommendation } from '@/lib/flights/assembleRecommendation';

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
  const tripType    = tripStyle === 'circuit' ? 'circuit' : 'city';

  // TEMP: hardcoded until leaderboard passes destination slug
  const destinationSlug = 'barcelona';

  const DESTINATION_AIRPORT: Record<string, string> = {
    'barcelona':            'BCN',
    'andalusian-corridor':  'SVQ',
    'algarve':              'FAO',
    'tuscany':              'PSA',
    'apulia':               'BRI',
    'french-riviera':       'NCE',
    'crete':                'CHQ',
    'catalonia':            'BCN',
    'croatia':              'SPU',
    'porto':                'OPO',
    'malta':                'MLA',
    'rome':                 'FCO',
    'lisbon':               'LIS',
    'amsterdam':            'AMS',
    'copenhagen':           'CPH',
    'munich':               'MUC',
    'vienna':               'VIE',
    'venice':               'VCE',
    'seville':              'SVQ',
    'gran-canaria':         'LPA',
  };
  const destinationAirport = DESTINATION_AIRPORT[destinationSlug];

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

  // ── Wave 1: savings breakdown + compliance + smart recommendation ──────────
  const [savingsResult, complianceResult, smartResult, schoolResult] = await Promise.all([
    supabase.rpc('get_savings_breakdown', {
      p_destination_slug: destinationSlug,
      p_school_urn:       urn,
      p_window_start:     windowStart,
      p_window_end:       windowEnd,
      p_trip_type:        tripType,
      p_adults:           adults,
      p_children:         children,
      p_infants:          infants,
    }),
    supabase.rpc('get_compliance_scenarios', {
      p_destination_slug: destinationSlug,
      p_school_urn:       urn,
      p_trip_type:        tripType,
      p_adults:           adults,
      p_children:         children,
      p_infants:          infants,
    }),
    supabase.rpc('get_smart_recommendation', {
      p_destination_slug: destinationSlug,
      p_school_urn:       urn,
      p_trip_type:        tripType,
      p_adults:           adults,
      p_children:         children,
      p_infants:          infants,
      p_cabin_bags:       adults,
      p_checked_bags:     tripType === 'circuit' ? adults : 0,
      p_seats_together:   true,
    }),
    supabase
      .from('all_schools')
      .select('postcode_district, borough')
      .eq('urn', urn)
      .maybeSingle(),
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

  // ── Assemble smart recommendation (transit-enriched) ──────────────────────
  const postcodeDistrict = (schoolResult.data as any)?.postcode_district ?? 'SW1A';
  const smartRaw = smartResult.error ? null : (smartResult.data as any);
  const assembled = smartRaw
    ? await assembleRecommendation(smartRaw, postcodeDistrict, adults, children, infants)
    : null;
  const recommendation    = assembled?.recommendation  ?? null;
  const assembledBaseline = assembled?.baseline        ?? null;

  // Override Wave 2 date sources with recommendation dates when available
  const outboundDate = recommendation?.outbound_date ?? bestOutboundDate;
  const returnDate   = recommendation?.return_date   ?? bestReturnDate;
  const originIata   = recommendation?.origin_iata   ?? bestOriginIata;

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
      p_outbound_date:    outboundDate,
      p_return_date:      returnDate,
      p_adults:           adults,
      p_children:         children,
      p_infants:          infants,
      p_transport_mode:   'public_transport',
    }),
    supabase.rpc('get_multi_airport', {
      p_destination_slug: destinationSlug,
      p_school_urn:       urn,
      p_outbound_date:    outboundDate,
      p_return_date:      returnDate,
      p_adults:           adults,
      p_children:         children,
      p_infants:          infants,
    }),
    supabase.rpc('get_bucket_split', {
      p_destination_slug: destinationSlug,
      p_origin_iata:      originIata,
      p_outbound_date:    outboundDate,
      p_return_date:      returnDate,
      p_adults:           adults,
      p_children:         children,
      p_infants:          infants,
    }),
    supabase.rpc('get_open_jaw', {
      p_destination_slug: destinationSlug,
      p_school_urn:       urn,
      p_outbound_date:    outboundDate,
      p_return_date:      returnDate,
      p_adults:           adults,
      p_children:         children,
      p_infants:          infants,
    }),
    supabase.rpc('get_nearby_destination_airports', {
      p_destination_slug: destinationSlug,
      p_school_urn:       urn,
      p_outbound_date:    outboundDate,
      p_return_date:      returnDate,
      p_adults:           adults,
      p_children:         children,
      p_infants:          infants,
    }),
  ]);

  const complianceData = complianceResult.error ? null : complianceResult.data

  // Wave 2 errors are non-fatal — null means that section won't render
  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-content mx-auto px-margin-desktop py-xl flex flex-col gap-xl">
        <SavingsBreakdown
          data={savingsData}
          recommendation={recommendation}
          baseline={assembledBaseline}
          adults={adults}
          children={children}
          windowStart={windowStart}
          destinationSlug={destinationSlug}
          boroughName={(schoolResult.data as any)?.borough ?? null}
          outbound_transit={recommendation?.outbound_transit ?? null}
          return_transit={recommendation?.return_transit ?? null}
          postcodeDistrict={postcodeDistrict}
          p_cabin_bags={adults}
          p_checked_bags={tripType === 'circuit' ? adults : 0}
          party_size={adults + children}
        />
        {complianceData && (
          <ComplianceCalculator
            data={complianceData}
            bestOutboundDate={bestOutboundDate}
            bestReturnDate={bestReturnDate}
            tripType={tripType}
          />
        )}
        <AllInCost
          data={allinResult.error ? null : (allinResult.data as any)}
          tripType={tripType}
          destinationAirport={destinationAirport}
        />
      </div>
    </main>
  );
}
