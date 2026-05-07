'use client';

import { useState } from 'react';
import type { Party } from '@/types/flight';
import { TravellerBanner }            from '@/components/flight-insights/TravellerBanner';
import { SkeletonSection, SKELETONS } from '@/components/flight-insights/SkeletonSection';
import { SchoolCalendarSection }      from '@/components/flight-insights/SchoolCalendarSection';
import { ComplianceCalculatorSection } from '@/components/flight-insights/ComplianceCalculatorSection';
import { FamilyCostSection }           from '@/components/flight-insights/FamilyCostSection';
import { CapacityWarningSection }      from '@/components/flight-insights/CapacityWarningSection';
import { MultiAirportSection }         from '@/components/flight-insights/MultiAirportSection';
import { OpenJawSection }              from '@/components/flight-insights/OpenJawSection';
import { StopoverSection }             from '@/components/flight-insights/StopoverSection';
import { NearbyAirportsSection }       from '@/components/flight-insights/NearbyAirportsSection';
import { MultiModalSection }           from '@/components/flight-insights/MultiModalSection';
import { RailChildSection }            from '@/components/flight-insights/RailChildSection';
import { OneWayReturnSection }         from '@/components/flight-insights/OneWayReturnSection';
import {
  calendarData, complianceScenarios, familyCostData, capacityWarning,
  airportFares, openJawItineraries, stopoverRoutes, nearbyAirports,
  multiModalRoutes, railChildPolicies, fareConfigs,
} from './mock-data';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SchoolContext {
  school: string;
  borough: string;
  breakLabel: string;
  dateRange: string;
}

interface Props {
  schoolContext: SchoolContext;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const SAGE_CHIP = { background: 'rgba(95,141,84,0.1)', color: '#3d6b33' };

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block font-inter text-label-sm px-md py-xs rounded-full" style={SAGE_CHIP}>
      {children}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function FlightInsightsClient({ schoolContext }: Props) {
  const [party, setParty]         = useState<Party>({ adults: 2, children: 1, childAges: [5] });
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(adults: number, children: number, childAges: number[]) {
    setParty({ adults, children, childAges });
    setSubmitted(true);
  }

  function handleEdit() {
    setSubmitted(false);
  }

  const partySize = party.adults + party.children;
  const showRailChild = party.children > 0 && party.childAges.some((age) => age < 15);

  const headerChips = [
    schoolContext.borough,
    schoolContext.breakLabel,
    schoolContext.dateRange,
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-background">

      {/* ── Nav (scrolls away) ───────────────────────────────────────────── */}
      <nav className="max-w-content mx-auto px-margin-desktop py-lg flex items-center justify-between">
        <a href="/" className="font-newsreader text-headline-md text-primary no-underline">
          Holiday Smart
        </a>
        <ul className="flex gap-xl list-none">
          <li>
            <a href="/#how-it-works" className="font-inter text-label-md text-on-surface-variant hover:text-primary transition-colors">
              How it works
            </a>
          </li>
          <li>
            <a href="#" className="font-inter text-label-md text-on-surface-variant hover:text-primary transition-colors">
              Sign in
            </a>
          </li>
        </ul>
      </nav>

      {/* ── Sticky group: header + banner ───────────────────────────────── */}
      <div className="sticky top-0 z-20">

        {/* Page header */}
        <header className="bg-background border-b border-outline-variant">
          <div className="max-w-content mx-auto px-margin-desktop py-md flex flex-wrap items-center justify-between gap-md">
            <div>
              <span className="block font-inter text-label-sm uppercase tracking-widest text-primary-container mb-xs">
                Flight Insights
              </span>
              <h1 className="font-newsreader text-headline-md text-on-surface">
                {schoolContext.school}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-sm">
              {headerChips.map((chip) => <Chip key={chip}>{chip}</Chip>)}

              {/* Traveller chip — shown after submit */}
              {submitted && (
                <Chip>
                  {party.adults}A
                  {party.children > 0 && ` · ${party.children}C (${party.childAges.join(', ')})`}
                </Chip>
              )}

              {/* Edit travellers link */}
              {submitted && (
                <button
                  onClick={handleEdit}
                  className="font-inter text-label-sm text-primary border border-primary rounded-full px-md py-xs hover:bg-primary hover:text-on-primary transition-colors"
                >
                  Edit travellers
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Banner — hidden once submitted */}
        {!submitted && (
          <TravellerBanner
            defaultAdults={party.adults}
            defaultChildren={party.children}
            defaultChildAges={party.childAges}
            onSubmit={handleSubmit}
          />
        )}
      </div>

      {/* ── Page content ─────────────────────────────────────────────────── */}
      <main className="max-w-content mx-auto px-margin-desktop py-xl flex flex-col gap-xl">
        {!submitted ? (
          /* Skeleton state */
          <>
            <SkeletonSection {...SKELETONS.calendar} />
            <SkeletonSection {...SKELETONS.compliance} />
            <SkeletonSection {...SKELETONS.familyCost} />
            <SkeletonSection {...SKELETONS.capacityWarning} />
            <SkeletonSection {...SKELETONS.multiAirport} />
            <SkeletonSection {...SKELETONS.openJaw} />
            <SkeletonSection {...SKELETONS.stopover} />
            <SkeletonSection {...SKELETONS.nearbyAirports} />
            <SkeletonSection {...SKELETONS.multiModal} />
            {/* Rail child skeleton only if plausibly applicable */}
            <SkeletonSection {...SKELETONS.railChild} />
            <SkeletonSection {...SKELETONS.oneWayReturn} />
          </>
        ) : (
          /* Real content, party-aware */
          <>
            <SchoolCalendarSection data={calendarData} />
            <ComplianceCalculatorSection scenarios={complianceScenarios} borough={schoolContext.borough} party={party} />
            <FamilyCostSection fares={familyCostData} partySize={partySize} />
            <CapacityWarningSection warning={capacityWarning} partySize={partySize} />
            <MultiAirportSection fares={airportFares} destination="Alicante" travelDate="23 May 2025" partySize={partySize} />
            <OpenJawSection itineraries={openJawItineraries} partySize={partySize} />
            <StopoverSection routes={stopoverRoutes} destination="Maldives" directPrice={2100} party={party} />
            <NearbyAirportsSection options={nearbyAirports} partySize={partySize} />
            <MultiModalSection routes={multiModalRoutes} partySize={partySize} />
            {showRailChild && <RailChildSection policies={railChildPolicies} party={party} />}
            <OneWayReturnSection configs={fareConfigs} route="London → Alicante" travelDate="23 May 2025" partySize={partySize} />
          </>
        )}
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-outline-variant mt-xl">
        <div className="max-w-content mx-auto px-margin-desktop py-xl flex items-center justify-between gap-xl">
          <a href="/" className="font-newsreader text-headline-md text-primary no-underline">Holiday Smart</a>
          <ul className="flex gap-lg list-none flex-wrap">
            {['About Us', 'Privacy Policy', 'Holiday Calendar', 'Contact Support'].map((link) => (
              <li key={link}>
                <a href="#" className="font-inter text-label-md text-on-surface-variant hover:text-primary transition-colors no-underline">
                  {link}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div className="border-t border-outline-variant">
          <div className="max-w-content mx-auto px-margin-desktop py-md">
            <span className="font-inter text-label-sm text-outline">© 2026 Smart Travel Planning.</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
