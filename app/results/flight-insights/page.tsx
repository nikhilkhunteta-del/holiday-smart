import type {
  SchoolCalendarData,
  ComplianceScenario,
  FareCostBreakdown,
  CapacityWarning,
  AirportFare,
  OpenJawItinerary,
  StopoverRoute,
  NearbyAirportOption,
  MultiModalRoute,
  RailChildPolicy,
  FareConfig,
} from '@/types/flight';

import { SchoolCalendarSection }     from '@/components/flight-insights/SchoolCalendarSection';
import { ComplianceCalculatorSection } from '@/components/flight-insights/ComplianceCalculatorSection';
import { FamilyCostSection }          from '@/components/flight-insights/FamilyCostSection';
import { CapacityWarningSection }     from '@/components/flight-insights/CapacityWarningSection';
import { MultiAirportSection }        from '@/components/flight-insights/MultiAirportSection';
import { OpenJawSection }             from '@/components/flight-insights/OpenJawSection';
import { StopoverSection }            from '@/components/flight-insights/StopoverSection';
import { NearbyAirportsSection }      from '@/components/flight-insights/NearbyAirportsSection';
import { MultiModalSection }          from '@/components/flight-insights/MultiModalSection';
import { RailChildSection }           from '@/components/flight-insights/RailChildSection';
import { OneWayReturnSection }        from '@/components/flight-insights/OneWayReturnSection';

// ── Mock data ───────────────────────────────────────────────────────────────

const calendarData: SchoolCalendarData = {
  schoolName: 'Grasmere Primary School',
  borough: 'Hackney',
  breakLabel: 'May half-term',
  officialStart: '2025-05-23',
  officialEnd: '2025-05-30',
  officialDays: 8,
  insetDays: [{ date: '2025-05-22', label: 'Inset day — school closed' }],
  londonAverageStartDate: '2025-05-26',
  londonAverageEndDate: '2025-05-30',
  percentileEarlier: 73,
  adjacentWeekend: { before: true, after: true },
  stretchWindows: [
    {
      label: 'Inset stretch',
      startDate: '2025-05-22',
      endDate: '2025-05-30',
      totalDays: 9,
      type: 'inset-stretch',
    },
    {
      label: 'Weekend + inset stretch',
      startDate: '2025-05-17',
      endDate: '2025-06-01',
      totalDays: 16,
      type: 'extended-pre',
    },
  ],
};

const complianceScenarios: ComplianceScenario[] = [
  {
    label: 'Official break only',
    daysEarly: 0,
    departureDate: '2025-05-23',
    returnDate: '2025-05-30',
    flightCost: 1480,
    officialFlightCost: 1480,
    finePerParent: 0,
    parents: 2,
    children: 2,
    totalFine: 0,
    grossSaving: 0,
    netSaving: 0,
  },
  {
    label: 'Leave 1 day early',
    daysEarly: 1,
    departureDate: '2025-05-22',
    returnDate: '2025-05-30',
    flightCost: 980,
    officialFlightCost: 1480,
    finePerParent: 80,
    parents: 2,
    children: 2,
    totalFine: 320,
    grossSaving: 500,
    netSaving: 180,
  },
  {
    label: 'Leave 2 days early',
    daysEarly: 2,
    departureDate: '2025-05-21',
    returnDate: '2025-05-30',
    flightCost: 820,
    officialFlightCost: 1480,
    finePerParent: 160,
    parents: 2,
    children: 2,
    totalFine: 640,
    grossSaving: 660,
    netSaving: 20,
  },
  {
    label: 'Leave 3 days early',
    daysEarly: 3,
    departureDate: '2025-05-20',
    returnDate: '2025-05-30',
    flightCost: 740,
    officialFlightCost: 1480,
    finePerParent: 160,
    parents: 2,
    children: 2,
    totalFine: 640,
    grossSaving: 740,
    netSaving: 100,
  },
];

const familyCostData: FareCostBreakdown[] = [
  {
    carrier: 'easyJet',
    route: 'LTN → Alicante',
    headlinePerPerson: 89,
    baseFamilyTotal: 356,
    holdLuggage: 120,
    seatSelection: 60,
    speedyBoarding: 40,
    allInTotal: 576,
    familySplitRisk: true,
    splitWarningCarriers: ['easyJet'],
  },
  {
    carrier: 'Ryanair',
    route: 'STN → Alicante',
    headlinePerPerson: 72,
    baseFamilyTotal: 288,
    holdLuggage: 144,
    seatSelection: 80,
    speedyBoarding: 0,
    allInTotal: 512,
    familySplitRisk: true,
    splitWarningCarriers: ['Ryanair'],
  },
  {
    carrier: 'British Airways',
    route: 'LHR → Alicante',
    headlinePerPerson: 168,
    baseFamilyTotal: 672,
    holdLuggage: 0,
    seatSelection: 40,
    speedyBoarding: 0,
    allInTotal: 712,
    familySplitRisk: false,
    splitWarningCarriers: [],
  },
];

const capacityWarning: CapacityWarning = {
  carrier: 'easyJet',
  route: 'LTN → Palma',
  departureDate: '2025-05-23',
  fareClass: 'Standard',
  farePrice: 89,
  seatsRemaining: 3,
  partySize: 4,
  nextFareClass: 'FLEXI',
  nextFarePrice: 149,
  costImpact: 240,
};

const airportFares: AirportFare[] = [
  {
    airport: 'LTN',
    airportName: 'Luton',
    carrier: 'easyJet',
    fareFamily: 'Standard',
    price: 89,
    familyTotal: 576,
    transferMinutes: 55,
    transferCost: 38,
    transferMode: 'Thameslink',
    allInFromHome: 614,
    departureTime: '07:15',
    arrivalTime: '10:40',
    recommended: true,
  },
  {
    airport: 'STN',
    airportName: 'Stansted',
    carrier: 'Ryanair',
    fareFamily: 'Regular',
    price: 72,
    familyTotal: 512,
    transferMinutes: 50,
    transferCost: 62,
    transferMode: 'Stansted Express',
    allInFromHome: 574,
    departureTime: '06:40',
    arrivalTime: '10:05',
  },
  {
    airport: 'LGW',
    airportName: 'Gatwick',
    carrier: 'Vueling',
    fareFamily: 'Basic',
    price: 118,
    familyTotal: 648,
    transferMinutes: 45,
    transferCost: 52,
    transferMode: 'Gatwick Express',
    allInFromHome: 700,
    departureTime: '09:30',
    arrivalTime: '12:55',
  },
  {
    airport: 'LHR',
    airportName: 'Heathrow',
    carrier: 'British Airways',
    fareFamily: 'Euro Traveller',
    price: 168,
    familyTotal: 712,
    transferMinutes: 40,
    transferCost: 28,
    transferMode: 'Elizabeth line',
    allInFromHome: 740,
    departureTime: '11:00',
    arrivalTime: '14:25',
  },
  {
    airport: 'LCY',
    airportName: 'City',
    carrier: 'British Airways',
    fareFamily: 'Euro Traveller',
    price: 195,
    familyTotal: 780,
    transferMinutes: 22,
    transferCost: 8,
    transferMode: 'DLR',
    allInFromHome: 788,
    departureTime: '08:00',
    arrivalTime: '11:20',
  },
];

const openJawItineraries: OpenJawItinerary[] = [
  {
    id: 'bari-brindisi',
    label: 'Puglia open-jaw',
    outbound: { from: 'LHR', to: 'BRI', carrier: 'Ryanair', price: 340, date: '2025-05-23', time: '07:30 → 11:10' },
    inbound:  { from: 'BDS', to: 'LTN', carrier: 'Ryanair', price: 280, date: '2025-05-30', time: '14:00 → 16:45' },
    totalPrice: 155,
    familyTotal: 620,
    savingVsDirect: 280,
    note: 'Fly into Bari, explore Matera & Lecce, fly home from Brindisi. No backtracking.',
    tags: ['Open jaw', 'No backtrack', 'Puglia'],
  },
  {
    id: 'malaga-almeria',
    label: 'Andalucía split',
    outbound: { from: 'LGW', to: 'AGP', carrier: 'easyJet', price: 390, date: '2025-05-23', time: '08:00 → 11:40' },
    inbound:  { from: 'LEI', to: 'LGW', carrier: 'Ryanair', price: 260, date: '2025-05-30', time: '16:10 → 18:50' },
    totalPrice: 163,
    familyTotal: 650,
    savingVsDirect: 190,
    note: 'Málaga → Nerja → Sierra Nevada → Almería. Return from the quieter east.',
    tags: ['Open jaw', 'Road trip', 'Andalucía'],
  },
  {
    id: 'split-dubrovnik',
    label: 'Dalmatian coast run',
    outbound: { from: 'LHR', to: 'SPU', carrier: 'British Airways', price: 560, date: '2025-05-23', time: '10:30 → 14:20' },
    inbound:  { from: 'DBV', to: 'LGW', carrier: 'easyJet', price: 320, date: '2025-05-30', time: '13:00 → 15:45' },
    totalPrice: 220,
    familyTotal: 880,
    savingVsDirect: 120,
    note: 'Split to Dubrovnik by ferry. No airport transfers back to Split.',
    tags: ['Open jaw', 'Ferry link', 'Croatia'],
  },
];

const stopoverRoutes: StopoverRoute[] = [
  {
    id: 'istanbul',
    via: 'IST',
    viaCity: 'Istanbul',
    outboundCarrier: 'Turkish Airlines',
    totalDuration: '12h 45m',
    layoverDuration: '3h 20m',
    layoverAirportLounge: true,
    totalPrice: 390,
    familyTotal: 1560,
    directFamilyTotal: 2100,
    saving: 540,
    kidAgeFriction: 'amber',
    frictionReason: 'Long-haul feel for under-8s',
    minRecommendedAge: 6,
    highlight: "Istanbul lounge access included. Good kids' area.",
  },
  {
    id: 'reykjavik',
    via: 'KEF',
    viaCity: 'Reykjavik',
    outboundCarrier: 'Icelandair',
    totalDuration: '14h 10m',
    layoverDuration: '5h 00m',
    layoverAirportLounge: false,
    totalPrice: 310,
    familyTotal: 1240,
    directFamilyTotal: 2100,
    saving: 860,
    kidAgeFriction: 'green',
    highlight: 'Stopover program: free hotel stay if layover > 5 hrs.',
  },
  {
    id: 'doha',
    via: 'DOH',
    viaCity: 'Doha',
    outboundCarrier: 'Qatar Airways',
    totalDuration: '18h 30m',
    layoverDuration: '6h 45m',
    layoverAirportLounge: true,
    totalPrice: 280,
    familyTotal: 1120,
    directFamilyTotal: 2100,
    saving: 980,
    kidAgeFriction: 'red',
    frictionReason: 'Not recommended under 6 — very long total journey',
    minRecommendedAge: 8,
  },
];

const nearbyAirports: NearbyAirportOption[] = [
  {
    id: 'pisa-florence',
    targetCity: 'Florence',
    cheaperAirport: 'Pisa',
    cheaperAirportCode: 'PSA',
    mainAirport: 'Florence',
    mainAirportCode: 'FLR',
    flightPriceDiff: -140,
    onwardTransport: 'Direct train',
    onwardCost: 12,
    onwardDuration: '1h 5m',
    netSaving: 128,
    tags: ['Tuscany', 'Train link'],
  },
  {
    id: 'girona-barcelona',
    targetCity: 'Barcelona',
    cheaperAirport: 'Girona',
    cheaperAirportCode: 'GRO',
    mainAirport: 'Barcelona El Prat',
    mainAirportCode: 'BCN',
    flightPriceDiff: -180,
    onwardTransport: 'Sagalés bus to Barcelona Sants',
    onwardCost: 28,
    onwardDuration: '1h 15m',
    netSaving: 152,
    tags: ['Catalonia', 'Bus link'],
  },
  {
    id: 'beauvais-paris',
    targetCity: 'Paris',
    cheaperAirport: 'Paris Beauvais',
    cheaperAirportCode: 'BVA',
    mainAirport: 'Paris CDG',
    mainAirportCode: 'CDG',
    flightPriceDiff: -220,
    onwardTransport: 'Shuttle bus to Porte Maillot',
    onwardCost: 34,
    onwardDuration: '1h 20m',
    netSaving: 186,
    tags: ['Paris', 'Budget carrier hub'],
  },
  {
    id: 'bratislava-vienna',
    targetCity: 'Vienna',
    cheaperAirport: 'Bratislava',
    cheaperAirportCode: 'BTS',
    mainAirport: 'Vienna',
    mainAirportCode: 'VIE',
    flightPriceDiff: -160,
    onwardTransport: 'Flixbus to Vienna Hauptbahnhof',
    onwardCost: 20,
    onwardDuration: '1h 10m',
    netSaving: 140,
    tags: ['Central Europe', 'Bus link'],
  },
  {
    id: 'trapani-palermo',
    targetCity: 'Palermo',
    cheaperAirport: 'Trapani',
    cheaperAirportCode: 'TPS',
    mainAirport: 'Palermo',
    mainAirportCode: 'PMO',
    flightPriceDiff: -120,
    onwardTransport: 'Direct bus (Segesta)',
    onwardCost: 18,
    onwardDuration: '1h 50m',
    netSaving: 102,
    tags: ['Sicily', 'Bus link'],
  },
];

const multiModalRoutes: MultiModalRoute[] = [
  {
    id: 'eurostar-cdg',
    label: 'Eurostar → Paris + onward flight',
    modes: ['Eurostar', 'Flight'],
    legs: [
      { mode: 'eurostar', from: 'London St Pancras', to: 'Paris Gare du Nord', carrier: 'Eurostar', duration: '2h 20m', cost: 280, note: 'Family of 4, Standard Premier' },
      { mode: 'flight',   from: 'Paris CDG', to: 'Marrakech RAK', carrier: 'Air France', duration: '3h 15m', cost: 480 },
    ],
    totalCost: 760,
    familyTotal: 760,
    directFlightFamilyTotal: 1040,
    saving: 280,
    totalJourneyTime: '7h 30m',
    experienceScore: 5,
    experienceNote: 'City centre to city centre. Kids love the Eurostar.',
    tags: ['No airport transfers', 'Kid-friendly', 'Carbon-light'],
  },
  {
    id: 'ferry-santander',
    label: 'Brittany Ferries → Santander',
    modes: ['Ferry', 'Drive'],
    legs: [
      { mode: 'ferry', from: 'Portsmouth', to: 'Santander', carrier: 'Brittany Ferries', duration: '24h', cost: 620, note: 'Cabin for 4, car included' },
    ],
    totalCost: 620,
    familyTotal: 620,
    directFlightFamilyTotal: 900,
    saving: 280,
    totalJourneyTime: '24h + drive',
    experienceScore: 4,
    experienceNote: 'Car included. Kids enjoy the ferry. Arrives rested with all your gear.',
    tags: ['Car included', 'Overnight', 'No luggage limits'],
  },
];

const railChildPolicies: RailChildPolicy[] = [
  {
    id: 'db-children-free',
    operator: 'Deutsche Bahn',
    countries: ['Germany'],
    policy: 'Children under 15 travel free on all long-distance DB trains when registered under an accompanying adult at time of booking.',
    maxChildAge: 14,
    maxChildrenPerAdult: 3,
    requiresRegistration: true,
    route: 'Brussels → Cologne → Munich (Eurostar connection)',
    adultFare: 120,
    savingPerChild: 60,
    totalFamilySaving: 120,
    bookingNote: 'Register children at booking on bahn.de or via DB Navigator app. Names required.',
  },
  {
    id: 'sncf-children-discount',
    operator: 'SNCF (France)',
    countries: ['France'],
    policy: 'Children under 12 travel at 50% off adult TGV fares when booked in the same reservation.',
    maxChildAge: 11,
    maxChildrenPerAdult: 4,
    requiresRegistration: false,
    route: 'Paris → Nice / Marseille / Lyon',
    adultFare: 89,
    savingPerChild: 44,
    totalFamilySaving: 88,
    bookingNote: 'Select child age at booking on sncf-connect.com.',
  },
  {
    id: 'renfe-children-free',
    operator: 'Renfe',
    countries: ['Spain'],
    policy: 'Children under 14 travel free on AVE high-speed trains when accompanied by a fare-paying adult.',
    maxChildAge: 13,
    maxChildrenPerAdult: 2,
    requiresRegistration: false,
    route: 'Madrid → Barcelona → Valencia',
    adultFare: 110,
    savingPerChild: 55,
    totalFamilySaving: 110,
    bookingNote: 'Select "Niño" ticket type on renfe.com. Limited to 2 children per adult.',
  },
];

const fareConfigs: FareConfig[] = [
  {
    id: 'single-return',
    label: 'Single return — British Airways',
    outboundCarrier: 'British Airways',
    inboundCarrier: 'British Airways',
    outboundPrice: 168,
    inboundPrice: 142,
    totalPerPerson: 310,
    familyTotal: 1240,
    flexibility: 'high',
    notes: ['Bags included', 'Seat selection included', 'Changeable for fee'],
    recommended: false,
    tags: ['All-in', 'Single booking'],
  },
  {
    id: 'two-one-ways-same',
    label: 'Two one-ways — easyJet both ways',
    outboundCarrier: 'easyJet',
    inboundCarrier: 'easyJet',
    outboundPrice: 89,
    inboundPrice: 76,
    totalPerPerson: 165,
    familyTotal: 660,
    flexibility: 'low',
    notes: ['Bags extra £30pp each way', 'Seat selection extra', 'Non-refundable'],
    recommended: false,
    saving: 580,
    tags: ['Split booking', 'Budget carrier'],
  },
  {
    id: 'two-one-ways-split',
    label: 'Split carrier — easyJet out, Jet2 back',
    outboundCarrier: 'easyJet',
    inboundCarrier: 'Jet2',
    outboundPrice: 89,
    inboundPrice: 64,
    totalPerPerson: 153,
    familyTotal: 612,
    flexibility: 'medium',
    notes: ['Jet2 includes 22kg bag free', 'easyJet bags extra', 'Two separate bookings'],
    recommended: true,
    saving: 628,
    tags: ['Best value', 'Split carrier', 'Bag saving'],
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function fmtDateRange(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end   + 'T00:00:00');
  const sy = s.getFullYear(), ey = e.getFullYear();
  const sf = `${s.getDate()} ${MONTHS[s.getMonth()]}${sy !== ey ? ' ' + sy : ''}`;
  const ef = `${e.getDate()} ${MONTHS[e.getMonth()]} ${ey}`;
  return `${sf} – ${ef}`;
}

// ── Page ────────────────────────────────────────────────────────────────────

interface PageProps {
  searchParams: { school?: string; urn?: string; borough?: string; break?: string; start?: string; end?: string };
}

export default function FlightInsightsPage({ searchParams }: PageProps) {
  const school    = searchParams.school   || searchParams.urn || 'Your school';
  const borough   = searchParams.borough  || 'Your borough';
  const breakLabel = searchParams.break   || 'Your break';
  const startDate = searchParams.start    || '';
  const endDate   = searchParams.end      || '';
  const dateRange = startDate && endDate ? fmtDateRange(startDate, endDate) : '';

  const headerChips = [
    borough,
    breakLabel,
    dateRange,
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
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

      {/* Page header */}
      <header className="max-w-content mx-auto px-margin-desktop pt-xl pb-lg border-b border-outline-variant">
        <span className="block font-inter text-label-sm uppercase tracking-widest text-primary-container mb-md">
          Flight Insights
        </span>
        <h1 className="font-newsreader text-display-md text-on-surface mb-lg">
          {school}
        </h1>
        <div className="flex flex-wrap gap-sm">
          {headerChips.map((chip) => (
            <span
              key={chip}
              className="inline-block font-inter text-label-sm px-md py-xs rounded-full"
              style={{ background: 'rgba(95,141,84,0.1)', color: '#3d6b33' }}
            >
              {chip}
            </span>
          ))}
        </div>
      </header>

      {/* Sections */}
      <main className="max-w-content mx-auto px-margin-desktop py-xl flex flex-col gap-xl">
        <SchoolCalendarSection     data={calendarData} />
        <ComplianceCalculatorSection scenarios={complianceScenarios} borough={borough} />
        <FamilyCostSection         fares={familyCostData} />
        <CapacityWarningSection    warning={capacityWarning} />
        <MultiAirportSection       fares={airportFares} destination="Alicante" travelDate="23 May 2025" />
        <OpenJawSection            itineraries={openJawItineraries} />
        <StopoverSection           routes={stopoverRoutes} destination="Maldives" directPrice={2100} />
        <NearbyAirportsSection     options={nearbyAirports} />
        <MultiModalSection         routes={multiModalRoutes} />
        <RailChildSection          policies={railChildPolicies} />
        <OneWayReturnSection       configs={fareConfigs} route="London → Alicante" travelDate="23 May 2025" />
      </main>

      {/* Footer */}
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
