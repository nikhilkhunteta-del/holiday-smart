'use client';

import type { Party } from '@/types/flight';
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
  party: Party;
}

// ── Composition mapping ──────────────────────────────────────────────────────

const DB_COMPOSITIONS = [
  { key: '1A+1C',   adults: 1, children: 1, infants: 0 },
  { key: '2A+1C',   adults: 2, children: 1, infants: 0 },
  { key: '2A+2C',   adults: 2, children: 2, infants: 0 },
  { key: '2A+1inf', adults: 2, children: 0, infants: 1 },
] as const;

function resolveComposition(party: Party): { key: string; isExact: boolean } {
  const { adults, children, infants = 0 } = party;
  const exact = DB_COMPOSITIONS.find(
    c => c.adults === adults && c.children === children && c.infants === infants,
  );
  if (exact) return { key: exact.key, isExact: true };

  let key = '2A+1C';
  if (infants > 0 && children === 0)  key = '2A+1inf';
  else if (children >= 2)             key = '2A+2C';
  else if (children === 1 && adults === 1) key = '1A+1C';

  return { key, isExact: false };
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

export function FlightInsightsClient({ schoolContext, party }: Props) {
  const compositionMatch = resolveComposition(party);
  const partySize   = party.adults + party.children;
  const showRailChild = party.children > 0 && party.childAges.some((age) => age < 15);

  const travellerLabel = [
    `${party.adults}A`,
    party.children > 0 ? `${party.children}C (${party.childAges.join(', ')})` : null,
    party.infants && party.infants > 0 ? `${party.infants} inf` : null,
  ].filter(Boolean).join(' · ');

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

      {/* ── Sticky header ───────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 bg-background border-b border-outline-variant">
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

            {/* Traveller chip — display-only summary */}
            <Chip>{travellerLabel}</Chip>

            {/* Edit travellers — routes back to landing page */}
            <a
              href="/"
              className="font-inter text-label-sm text-primary border border-primary rounded-full px-md py-xs hover:bg-primary hover:text-on-primary transition-colors no-underline"
            >
              Edit travellers
            </a>
          </div>
        </div>

        {/* Nearest-profile note — only when composition isn't an exact DB match */}
        {!compositionMatch.isExact && (
          <div className="border-t border-outline-variant">
            <div className="max-w-content mx-auto px-margin-desktop py-xs">
              <span className="font-inter text-label-sm text-outline">
                Showing prices for the nearest available family profile ({compositionMatch.key}).
              </span>
            </div>
          </div>
        )}
      </header>

      {/* ── Page content ─────────────────────────────────────────────────── */}
      <main className="max-w-content mx-auto px-margin-desktop py-xl flex flex-col gap-xl">
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
