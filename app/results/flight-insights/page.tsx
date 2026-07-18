import { supabaseServer as supabase } from '@/lib/supabase-server';
import { SavingsBreakdown } from '@/components/flight-insights/savings-breakdown';
import { ComplianceCalculator } from '@/components/flight-insights/compliance-calculator';
import { PreferencesCard } from '@/components/flight-insights/preferences-card';
import { AIRecommendationClient } from '@/components/flight-insights/ai-recommendation-client';
import { FlightInsightsProvider } from '@/components/flight-insights/flight-insights-context';
import { assembleCombinationsOnly, buildAssemblyPrecomputed } from '@/lib/flights/assembleRecommendation';
import { buildScenarioResults } from '@/lib/flights/buildScenarioResults';
import { ScenarioStrip } from '@/components/flight-insights/scenario-strip';

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
  const seatsTogether     = searchParams.seats === 'true';
  const transitPreference = (searchParams.transit === 'uber' ? 'uber' : searchParams.transit === 'transit' ? 'transit' : 'auto') as 'auto' | 'uber' | 'transit';

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

  // Resolve nearest airport + fetch all transit rows once; share across main
  // assembly and all scenario calls to avoid 4× repeated DB round trips.
  const precomputed = smartRaw
    ? await buildAssemblyPrecomputed(
        smartRaw.combinations ?? [],
        smartRaw.baseline ?? {},
        postcodeDistrict,
        adults,
        children,
        infants,
        cabinBags,
        checkedBags,
      )
    : null;

  // Scenarios that change checkedBags must build their own transit cache so the
  // Uber-XL multiplier (isXL when checkedBags >= 2) fires with the correct count.
  // Pass only nearestAirport + bagFeesCache + original bag counts from precomputed —
  // skips the airport DB lookup and transit cache but triggers a fresh
  // buildRawTransitCache with the scenario's own checkedBags.
  const airportOnly = precomputed ? {
    nearestAirport: precomputed.nearestAirport,
    bagFeesCache: precomputed.bagFeesCache,
    originalCabinBags: cabinBags,
    originalCheckedBags: checkedBags,
  } : undefined;

  const assembled = smartRaw
    ? await assembleCombinationsOnly(
        smartRaw,
        postcodeDistrict,
        adults,
        children,
        infants,
        transitPreference,
        cabinBags,
        checkedBags,
        seatsTogether,
        precomputed ?? undefined,
      )
    : null;

  // ── Scenario pre-computation (parallel) ────────────────────────────────
  // Each scenario re-assembles with different params. Bag costs are recalculated
  // from airline_baggage_fees via bagFeesCache; destination transfer flips use
  // taxi costs when in uber mode.
  const [
    scenarioLightResult,
    scenarioCheckedResult,
    scenarioUberResult,
  ] = await Promise.all([
    smartRaw ? assembleCombinationsOnly(
      smartRaw, postcodeDistrict, adults, children, infants,
      transitPreference, 0, 0, seatsTogether, airportOnly,
    ) : null,
    smartRaw ? assembleCombinationsOnly(
      smartRaw, postcodeDistrict, adults, children, infants,
      transitPreference, cabinBags, checkedBags + 1, seatsTogether, airportOnly,
    ) : null,
    // Flip transit mode — same bags as main call; shares full precomputed transit cache.
    // applyTransitPreference runs independently per call so the override is never shared.
    smartRaw && transitPreference !== 'uber'
      ? assembleCombinationsOnly(
          smartRaw, postcodeDistrict, adults, children, infants,
          'uber', cabinBags, checkedBags, seatsTogether, precomputed ?? undefined,
        )
      : smartRaw
      ? assembleCombinationsOnly(
          smartRaw, postcodeDistrict, adults, children, infants,
          'auto', cabinBags, checkedBags, seatsTogether, precomputed ?? undefined,
        )
      : null,
  ]);

  // ── Dates ─────────────────────────────────────────────────────────────────
  const smartOutboundDate = assembled?.baselineIsRecommended
    ? assembled.baseline.outbound_date
    : assembled?.recommendation?.outbound_date ?? windowStart;

  const smartReturnDate = assembled?.baselineIsRecommended
    ? assembled.baseline.return_date
    : assembled?.recommendation?.return_date ?? windowEnd;

  // ── Open jaw ─────────────────────────────────────────────────────────────
  const openJawResult = await supabase.rpc('get_open_jaw', {
    p_destination_slug: destinationSlug,
    p_school_urn:       urn,
    p_outbound_date:    smartOutboundDate,
    p_return_date:      smartReturnDate,
    p_adults:           adults,
    p_children:         children,
    p_infants:          infants,
  });

  const savingsData       = savingsResult.data as any;
  const recommendation    = assembled?.recommendation  ?? null;
  const assembledBaseline = assembled?.baseline        ?? null;
  const savingCategory    = assembled?.savingCategory  ?? 'significant';
  const hasInsetDay       = assembled?.combinations?.some(c => c.is_inset_day) ?? false;

  const hsSaving = assembled
    ? (assembled.baseline?.total_cost_gbp ?? 0) -
      (assembled.recommendation?.total_cost_gbp ?? assembled.baseline?.total_cost_gbp ?? 0)
    : 0;

  const combinationCount = assembled?.combinations?.length ?? 0;

  const scenarios = buildScenarioResults(
    recommendation,
    assembled,
    { light: scenarioLightResult, checked: scenarioCheckedResult,
      uber:  scenarioUberResult,  seats: null },
    { cabinBags, checkedBags, seatsTogether, transitPreference, adults },
  );

  const currentPageUrl = `/results/flight-insights?urn=${urn}&start=${windowStart}&end=${windowEnd}&adults=${adults}&children=${children}&tripStyle=${tripStyle}&cabin_bags=${cabinBags}&checked_bags=${checkedBags}&seats=${seatsTogether}&transit=${transitPreference}`;

  const combinationRange = assembled?.combinations
    ? Math.max(...assembled.combinations.map((c: any) => c.total_inc_fine ?? 0)) -
      Math.min(...assembled.combinations
        .filter((c: any) => !c.requires_absence)
        .map((c: any) => c.total_inc_fine ?? 0))
    : null;

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
    currentPageUrl,
    savingCategory,
    combinationCount,
    baselineIsRecommended: assembled?.baselineIsRecommended ?? false,
  };

  return (
    <FlightInsightsProvider>
      <main className="min-h-screen bg-background">
        <div className="max-w-content mx-auto px-gutter py-xl flex flex-col gap-xl">

          {/* 1. PreferencesCard — renders immediately, outside the AI gate */}
          <PreferencesCard
            cabinBags={cabinBags}
            checkedBags={checkedBags}
            seatsTogether={seatsTogether}
            transitPreference={transitPreference}
            postcodeDistrict={postcodeDistrict}
            outboundCarrier={recommendation?.outbound_carrier ?? null}
            adults={adults}
          />

          {/* 2. AIRecommendationClient gates all remaining content until AI resolves */}
          <AIRecommendationClient
            fetchParams={aiFetchParams}
            schoolName={schoolName}
            hasInsetDay={hasInsetDay}
            recommendation={recommendation}
            combinations={assembled?.combinations ?? null}
            hsSaving={hsSaving}
            benchmarkCost={assembled?.baseline?.total_cost_gbp ?? null}
            scenarios={scenarios}
            baseline={assembled?.baseline ? {
              outbound_date:           assembled.baseline.outbound_date,
              return_date:             assembled.baseline.return_date,
              origin_iata:             assembled.baseline.origin_iata,
              destination_iata:        assembled.baseline.destination_iata,
              carrier:                 assembled.baseline.carrier,
              outbound_departure_time: assembled.baseline.outbound_departure_time,
              outbound_arrival_time:   assembled.baselineAsCombination?.outbound_arrival_time ?? null,
              return_departure_time:   assembled.baselineAsCombination?.return_departure_time ?? null,
              return_arrival_time:     assembled.baselineAsCombination?.return_arrival_time ?? null,
              total_cost_gbp:          assembled.baseline.total_cost_gbp,
            } : null}
          >

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

            {/* 4. ComplianceCalculator — includes the "How we chose these
                prices" collapsible (formerly the standalone ComparisonTable
                section) below the legend */}
            {assembled && (
              <ComplianceCalculator
                combinations={assembled.combinations}
                baseline={assembled.baseline}
                recommendation={assembled.recommendation}
                windowStart={windowStart}
                windowEnd={windowEnd}
                partySize={adults + children}
                adults={adults}
                children={children}
                infants={infants}
                pCabinBags={cabinBags}
                pCheckedBags={checkedBags}
                seatsTogether={seatsTogether}
                baselineIsRecommended={assembled.baselineIsRecommended}
                combinationRange={combinationRange}
                destinationSlug={destinationSlug}
                schoolUrn={urn}
                transportMode={searchParams.transit ?? 'auto'}
                postcodeDistrict={postcodeDistrict}
                comparisonResult={assembled}
              />
            )}


          </AIRecommendationClient>

        </div>
      </main>
    </FlightInsightsProvider>
  );
}
