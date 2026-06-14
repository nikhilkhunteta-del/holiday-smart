import { supabaseServer as supabase } from '@/lib/supabase-server';
import { SavingsBreakdown } from '@/components/flight-insights/savings-breakdown';
import { ComplianceCalculator } from '@/components/flight-insights/compliance-calculator';
import { PreferencesCard } from '@/components/flight-insights/preferences-card';
import { LegOptions } from '@/components/flight-insights/leg-options';
import { AIRecommendationClient } from '@/components/flight-insights/ai-recommendation-client';
import { FlightInsightsProvider } from '@/components/flight-insights/flight-insights-context';
import { HSValueSummary } from '@/components/flight-insights/hs-value-summary';
import { assembleCombinationsOnly } from '@/lib/flights/assembleRecommendation';
import type { ScenarioResult } from '@/lib/flights/computeScenarios';
import { ScenarioStrip } from '@/components/flight-insights/scenario-strip';
import type { CombinationsOnlyResult } from '@/lib/flights/assembleRecommendation';

export const dynamic = 'force-dynamic';

// ── Server-side scenario comparison ────────────────────────────────────────
// Compares pre-assembled scenario results against current assembly to produce
// ScenarioResult[] without re-running client-side cost adjustments.
function buildScenarioResults(
  recommendation: CombinationsOnlyResult['recommendation'] | null,
  current:        CombinationsOnlyResult | null,
  scenarioResults: {
    light:   CombinationsOnlyResult | null;
    checked: CombinationsOnlyResult | null;
    uber:    CombinationsOnlyResult | null;
    seats:   CombinationsOnlyResult | null;
  },
  opts: {
    cabinBags:          number;
    checkedBags:        number;
    seatsTogether:      boolean;
    transitPreference:  'auto' | 'uber';
    adults:             number;
  },
): ScenarioResult[] {
  if (!current || !recommendation) return [];

  const currentTotal = recommendation.total_cost_gbp;
  const results: ScenarioResult[] = [];

  const makeResult = (
    lever: string,
    headline: string,
    scenarioResult: CombinationsOnlyResult | null,
    urlParams: Record<string, string>,
    facts: Record<string, string | number | boolean | null>,
  ): ScenarioResult | null => {
    if (!scenarioResult) return null;
    const rec    = scenarioResult.recommendation;
    const saving = Math.round(currentTotal - rec.total_cost_gbp);
    const flightChanges =
      rec.outbound_date    !== recommendation.outbound_date ||
      rec.return_date      !== recommendation.return_date   ||
      rec.origin_iata      !== recommendation.origin_iata   ||
      rec.outbound_carrier !== recommendation.outbound_carrier;
    const tripNights = Math.round(
      (new Date(rec.return_date + 'T00:00:00').getTime() -
       new Date(rec.outbound_date + 'T00:00:00').getTime()) / 86400000,
    );
    return {
      lever,
      locked_headline: headline,
      current_total:   Math.round(currentTotal),
      scenario_total:  Math.round(rec.total_cost_gbp),
      saving,
      flight_changes:  flightChanges,
      scenario_winner: {
        outbound_date:    rec.outbound_date,
        return_date:      rec.return_date,
        outbound_carrier: rec.outbound_carrier,
        return_carrier:   rec.return_carrier,
        origin_iata:      rec.origin_iata,
        out_dest_iata:    rec.out_dest_iata,
        trip_nights:      tripNights,
      },
      facts,
      url_params: urlParams,
    };
  };

  // Travel light
  if (opts.cabinBags > 0) {
    const bagCost = Math.round(
      (recommendation.cabin_bag_cost_gbp ?? 0) +
      (recommendation.checked_bag_cost_gbp ?? 0),
    );
    if (bagCost > 0) {
      const r = makeResult(
        'travel_light',
        'Travel light — skip cabin bags',
        scenarioResults.light,
        { cabin_bags: '0', checked_bags: '0' },
        { bag_saving: bagCost, current_bags: opts.cabinBags },
      );
      if (r && r.saving > 0) results.push(r);
    }
  }

  // Skip seats (only if currently selected)
  if (opts.seatsTogether) {
    const seatCost = Math.round(recommendation.seat_cost_gbp ?? 0);
    if (seatCost > 0) {
      const r = makeResult(
        'skip_seats',
        'Skip seat selection — save the fee',
        null, // seat toggle doesn't change assembly — skip for now
        { seats: 'false' },
        { seat_saving: seatCost, caveat: 'You may not sit together — airlines try to seat families but cannot guarantee it.' },
      );
      if (r) results.push(r);
    }
  }

  // Transport flip
  if (scenarioResults.uber) {
    const uberRec = scenarioResults.uber.recommendation;
    const costDiff = Math.round(uberRec.total_cost_gbp - currentTotal);
    const label = opts.transitPreference !== 'uber'
      ? (costDiff > 0 ? `Door-to-door Uber — £${costDiff} more` : `Uber saves £${Math.abs(costDiff)}`)
      : `Public transport saves £${Math.abs(costDiff)}`;
    const r = makeResult(
      'transport_flip',
      label,
      scenarioResults.uber,
      { transit: opts.transitPreference !== 'uber' ? 'uber' : 'auto' },
      { cost_diff: costDiff, costs_more: costDiff > 0 },
    );
    if (r) results.push(r);
  }

  return results;
}

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
  const seatsTogether     = searchParams.seats === 'true';
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

  // ── Scenario pre-computation (parallel) ────────────────────────────────
  // Each scenario reruns full assembly with modified params so totals
  // exactly match what the "Try this" link would show.
  const [
    scenarioLightResult,
    scenarioCheckedResult,
    scenarioUberResult,
    scenarioSeatsResult,
  ] = await Promise.all([
    // Travel light: zero all bags
    smartRaw ? assembleCombinationsOnly(
      smartRaw, postcodeDistrict, adults, children, infants,
      transitPreference, 0, 0, seatsTogether,
    ) : null,
    // Add 1 checked bag per adult
    smartRaw ? assembleCombinationsOnly(
      smartRaw, postcodeDistrict, adults, children, infants,
      transitPreference, cabinBags, checkedBags + adults, seatsTogether,
    ) : null,
    // Flip transit mode
    smartRaw && transitPreference !== 'uber'
      ? assembleCombinationsOnly(
          smartRaw, postcodeDistrict, adults, children, infants,
          'uber', cabinBags, checkedBags, seatsTogether,
        )
      : smartRaw
      ? assembleCombinationsOnly(
          smartRaw, postcodeDistrict, adults, children, infants,
          'auto', cabinBags, checkedBags, seatsTogether,
        )
      : null,
    // Toggle seats together
    smartRaw && !seatsTogether
      ? assembleCombinationsOnly(
          smartRaw, postcodeDistrict, adults, children, infants,
          transitPreference, cabinBags, checkedBags, true,
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

  const hsSaving = assembled
    ? (assembled.baseline?.total_cost_gbp ?? 0) -
      (assembled.recommendation?.total_cost_gbp ?? assembled.baseline?.total_cost_gbp ?? 0)
    : 0;

  const combinationCount = assembled?.combinations?.length ?? 0;

  const scenarios = buildScenarioResults(
    recommendation,
    assembled,
    { light: scenarioLightResult, checked: scenarioCheckedResult,
      uber: scenarioUberResult, seats: scenarioSeatsResult },
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
                combinationRange={combinationRange}
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

            {/* 7. HSValueSummary */}
            <HSValueSummary
              saving={hsSaving}
              hasInsetDay={hasInsetDay}
              schoolName={schoolName}
              outboundCarrier={recommendation?.outbound_carrier ?? ''}
              returnCarrier={recommendation?.return_carrier ?? ''}
              combinationCount={combinationCount}
            />


          </AIRecommendationClient>

        </div>
      </main>
    </FlightInsightsProvider>
  );
}
