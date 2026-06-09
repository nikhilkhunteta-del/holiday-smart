import { supabaseServer as supabase } from '@/lib/supabase-server';
import { SavingsBreakdown } from '@/components/flight-insights/savings-breakdown';
import { ComplianceCalculator } from '@/components/flight-insights/compliance-calculator';
import { PreferencesCard } from '@/components/flight-insights/preferences-card';
import { LegOptions } from '@/components/flight-insights/leg-options';
import { AIRecommendationClient } from '@/components/flight-insights/ai-recommendation-client';
import { FlightInsightsProvider } from '@/components/flight-insights/flight-insights-context';
import { CTABlock } from '@/components/flight-insights/cta-block';
import { assembleCombinationsOnly } from '@/lib/flights/assembleRecommendation';

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
    cabin_bags?: string;
    checked_bags?: string;
    seats?: string;
    transit?: string;
    selected_outbound?: string;
    selected_return?: string;
  };
}

export default async function FlightInsightsPage({ searchParams }: PageProps) {
  const urn         = searchParams.urn;
  const windowStart = searchParams.start;
  const windowEnd   = searchParams.end;
  const adults      = Number(searchParams.adults   ?? 2);
  const children    = Number(searchParams.children ?? 0);
  const infants     = Number(searchParams.infants  ?? 0);
  const tripStyle   = searchParams.tripStyle;
  const tripType    = tripStyle === 'circuit' ? 'circuit' : 'city';

  const cabinBags         = parseInt(searchParams.cabin_bags   ?? String(adults));
  const checkedBags       = parseInt(searchParams.checked_bags ?? (tripType === 'circuit' ? String(adults) : '0'));
  const seatsTogether     = searchParams.seats !== 'false';
  const transitPreference = (searchParams.transit === 'uber' ? 'uber' : 'auto') as 'auto' | 'uber';

  const destinationSlug = 'barcelona';

  if (!urn || !windowStart || !windowEnd) {
    return (
      <div style={{ padding: 24, fontFamily: 'Inter, sans-serif' }}>
        <strong>Missing required parameters:</strong> urn, start, and end are all required.
      </div>
    );
  }

  // ── Three parallel server calls ───────────────────────────────────────────
  const [savingsResult, smartResult, schoolResult] = await Promise.all([
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
    supabase.rpc('get_smart_recommendation', {
      p_destination_slug: destinationSlug,
      p_school_urn:       urn,
      p_trip_type:        tripType,
      p_adults:           adults,
      p_children:         children,
      p_infants:          infants,
      p_cabin_bags:       cabinBags,
      p_checked_bags:     checkedBags,
      p_seats_together:   seatsTogether,
    }),
    supabase
      .from('all_schools')
      .select('postcode_district, borough, school_name')
      .eq('urn', urn)
      .maybeSingle(),
  ]);

  if (savingsResult.error || !savingsResult.data) {
    return (
      <div style={{ padding: 24, fontFamily: 'Inter, sans-serif' }}>
        <strong>Savings breakdown failed.</strong>
        <pre style={{ marginTop: 12, fontSize: 12 }}>
          {JSON.stringify({ error: savingsResult.error }, null, 2)}
        </pre>
      </div>
    );
  }

  // ── School context ────────────────────────────────────────────────────────
  const postcodeDistrict = (schoolResult.data as any)?.postcode_district ?? 'SW1A';
  const schoolName       = (schoolResult.data as any)?.school_name ?? null;
  const borough          = (schoolResult.data as any)?.borough ?? null;

  // ── Assemble combinations (fast, no AI) ──────────────────────────────────
  const smartRaw = smartResult.error ? null : (smartResult.data as any);
  const assembled = smartRaw
    ? await assembleCombinationsOnly(
        smartRaw,
        postcodeDistrict,
        adults,
        children,
        infants,
        transitPreference,
      )
    : null;

  // ── Dates ─────────────────────────────────────────────────────────────────
  const smartOutboundDate = assembled?.baselineIsRecommended
    ? assembled.baseline.outbound_date
    : assembled?.recommendation?.outbound_date ?? windowStart;

  const smartReturnDate = assembled?.baselineIsRecommended
    ? assembled.baseline.return_date
    : assembled?.recommendation?.return_date ?? windowEnd;

  const selectedOutbound = searchParams.selected_outbound ?? smartOutboundDate;
  const selectedReturn   = searchParams.selected_return   ?? smartReturnDate;

  // ── Leg options — parallel ────────────────────────────────────────────────
  const [openJawResult, outboundLegResult, returnLegResult] = await Promise.all([
    supabase.rpc('get_open_jaw', {
      p_destination_slug: destinationSlug,
      p_school_urn:       urn,
      p_outbound_date:    smartOutboundDate,
      p_return_date:      smartReturnDate,
      p_adults:           adults,
      p_children:         children,
      p_infants:          infants,
    }),
    supabase.rpc('get_leg_options', {
      p_destination_slug: destinationSlug,
      p_school_urn:       urn,
      p_date:             selectedOutbound,
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
      p_school_urn:       urn,
      p_date:             selectedReturn,
      p_direction:        'return',
      p_adults:           adults,
      p_children:         children,
      p_infants:          infants,
      p_cabin_bags:       cabinBags,
      p_checked_bags:     checkedBags,
      p_seats_together:   seatsTogether,
    }),
  ]);

  function formatDate(iso: string): string {
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const d = new Date(iso + 'T00:00:00');
    return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  }

  const savingsData       = savingsResult.data as any;
  const recommendation    = assembled?.recommendation  ?? null;
  const assembledBaseline = assembled?.baseline        ?? null;
  const savingCategory    = assembled?.savingCategory  ?? 'significant';
  const hasInsetDay       = assembled?.combinations?.some(c => c.is_inset_day) ?? false;

  // ── Params passed to client for AI fetch + preference re-runs ────────────
  const aiFetchParams = {
    destinationSlug,
    schoolUrn:        urn,
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
  };

  return (
    <FlightInsightsProvider>
      <main className="min-h-screen bg-background">
        <div className="max-w-content mx-auto px-margin-desktop py-xl flex flex-col gap-xl">

          {/* 1. PreferencesCard */}
          <PreferencesCard
            cabinBags={cabinBags}
            checkedBags={checkedBags}
            seatsTogether={seatsTogether}
            transitPreference={transitPreference}
            postcodeDistrict={postcodeDistrict}
          />

          {/* 2. AIRecommendationClient — fetched client-side, updates context */}
          <AIRecommendationClient
            fetchParams={aiFetchParams}
            schoolName={schoolName}
            hasInsetDay={hasInsetDay}
          />

          {/* 3. SavingsBreakdown */}
          <SavingsBreakdown
            data={savingsData}
            recommendation={recommendation}
            baseline={assembledBaseline}
            adults={adults}
            children={children}
            windowStart={windowStart}
            destinationSlug={destinationSlug}
            boroughName={borough}
            outbound_transit={recommendation?.outbound_transit ?? null}
            return_transit={recommendation?.return_transit ?? null}
            postcodeDistrict={postcodeDistrict}
            cabinBags={cabinBags}
            checkedBags={checkedBags}
            seatsTogether={seatsTogether}
            party_size={adults + children}
            combinations={assembled?.combinations}
            savingCategory={savingCategory}
            schoolName={schoolName}
            baselineIsRecommended={assembled?.baselineIsRecommended}
            baselineAsItinerary={assembled?.baselineAsItinerary}
          />

          {/* 4. ComplianceCalculator */}
          {assembled && (
            <ComplianceCalculator
              combinations={assembled.combinations}
              baseline={assembled.baseline}
              recommendation={assembled.recommendation}
              windowStart={windowStart}
              windowEnd={windowEnd}
              partySize={adults + children}
              pCabinBags={cabinBags}
              pCheckedBags={checkedBags}
              seatsTogether={seatsTogether}
              baselineIsRecommended={assembled.baselineIsRecommended}
              selectedOutbound={selectedOutbound}
              selectedReturn={selectedReturn}
            />
          )}

          {/* 5. LegOptions outbound */}
          <div id="leg-options">
            <LegOptions
              data={outboundLegResult?.error ? null : outboundLegResult?.data as any}
              title={`Outbound options · ${formatDate(smartOutboundDate)}`}
              adults={adults}
              children={children}
              infants={infants}
              transitPreference={transitPreference}
              postcodeDistrict={postcodeDistrict}
              selectedDate={selectedOutbound}
              smartDate={smartOutboundDate}
              recommendedOption={recommendation ? {
                airline_iata:     recommendation.outbound_carrier,
                origin_iata:      recommendation.origin_iata,
                destination_iata: recommendation.out_dest_iata,
                departure_time:   recommendation.outbound_departure_time ?? '',
              } : null}
            />
          </div>

          {/* 6. LegOptions return */}
          <LegOptions
            data={returnLegResult?.error ? null : returnLegResult?.data as any}
            title={`Return options · ${formatDate(smartReturnDate)}`}
            adults={adults}
            children={children}
            infants={infants}
            transitPreference={transitPreference}
            postcodeDistrict={postcodeDistrict}
            selectedDate={selectedReturn}
            smartDate={smartReturnDate}
            recommendedOption={recommendation ? {
              airline_iata:     recommendation.return_carrier,
              origin_iata:      recommendation.out_dest_iata,
              destination_iata: recommendation.ret_dest_iata,
              departure_time:   recommendation.return_arrival_time ?? '',
            } : null}
          />

          {/* 7. CTABlock */}
          <CTABlock
            adults={adults}
            children={children}
            fallbackOutboundDate={smartOutboundDate}
            fallbackReturnDate={smartReturnDate}
            fallbackOrigin={recommendation?.origin_iata ?? 'LHR'}
            fallbackOutDest={recommendation?.out_dest_iata ?? 'BCN'}
          />

        </div>
      </main>
    </FlightInsightsProvider>
  );
}
