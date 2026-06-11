'use client';

import { useState } from 'react';
import { useFlightInsights } from './flight-insights-context';
import type { AssembledCombination, AssembledBaseline, BaselineAsItinerary } from '@/lib/flights/assembleRecommendation';

// ── Interfaces ─────────────────────────────────────────────────────────────────

interface Lever {
  label: string;
  winner: string;
  saving: number;
  above_threshold: boolean;
  is_borough_specific: boolean;
}

export interface SavingsData {
  baseline_price: number;
  smart_price: number;
  total_yield: number;
  net_yield: number;
  fine_gbp: number;
  fine_is_estimate: boolean;
  requires_absence: boolean;
  best_outbound_date: string;
  best_return_date: string;
  departure_absence_days: number;
  return_absence_days: number;
  levers: Lever[];
}

interface Props {
  data: SavingsData;        // kept for interface stability; no longer rendered
  adults: number;
  children: number;
  windowStart: string;
  destinationSlug: string;
  boroughName: string | null;
  recommendation: AssembledCombination | null;
  baseline: AssembledBaseline | null;
  outbound_transit: AssembledCombination['outbound_transit'] | null;
  return_transit: AssembledCombination['return_transit'] | null;
  postcodeDistrict: string | null;
  cabinBags: number;
  checkedBags: number;
  seatsTogether: boolean;
  party_size: number;
  combinations?: AssembledCombination[];
  savingCategory: 'significant' | 'modest' | 'minimal' | 'baseline_cheapest';
  schoolName: string | null;
  baselineIsRecommended?: boolean;
  baselineAsItinerary?: BaselineAsItinerary;
}

// ── Lookups ───────────────────────────────────────────────────────────────────

const AIRPORT_NAMES: Record<string, string> = {
  LHR: 'Heathrow',
  LGW: 'Gatwick',
  STN: 'Stansted',
  LTN: 'Luton',
  LCY: 'City',
};

const CARRIER_NAMES: Record<string, string> = {
  FR: 'Ryanair',
  U2: 'easyJet',
  W6: 'Wizz Air',
  VY: 'Vueling',
  BA: 'British Airways',
  TP: 'TAP',
  LS: 'Jet2',
};

const DESTINATION_NAMES: Record<string, string> = {
  'barcelona':            'Barcelona',
  'andalusian-corridor':  'Andalusia',
  'algarve':              'the Algarve',
  'tuscany':              'Tuscany',
  'apulia':               'Apulia',
  'french-riviera':       'the French Riviera',
  'crete':                'Crete',
  'catalonia':            'Catalonia',
  'croatia':              'Croatia',
  'porto':                'Porto',
  'malta':                'Malta',
  'rome':                 'Rome',
  'lisbon':               'Lisbon',
  'amsterdam':            'Amsterdam',
  'copenhagen':           'Copenhagen',
  'munich':               'Munich',
  'vienna':               'Vienna',
  'venice':               'Venice',
  'seville':              'Seville',
  'gran-canaria':         'Gran Canaria',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const DAY_ABBR   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmt(n: number): string {
  return '£' + Math.round(n).toLocaleString('en-GB');
}

function fmtShortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return `${DAY_ABBR[d.getDay()]} ${d.getDate()} ${MONTH_ABBR[d.getMonth()]}`;
}

function carrierName(iata: string): string {
  return CARRIER_NAMES[iata] ?? iata;
}

function transitLabel(
  transit: AssembledCombination['outbound_transit'] | null,
  airport: string,
  direction: 'to' | 'from',
): string {
  const arrow = direction === 'to' ? '→' : '←';
  if (!transit || transit.recommended_mode === 'uber') {
    return `Uber ${arrow} ${airport}`;
  }
  const summary = transit.transit?.route_summary ?? '';
  let service: string;
  if (/national express/i.test(summary))     service = 'National Express';
  else if (/stansted express/i.test(summary)) service = 'Stansted Express';
  else if (/thameslink/i.test(summary))       service = 'Thameslink';
  else if (/gatwick express/i.test(summary))  service = 'Gatwick Express';
  else                                        service = 'Bus';
  return `${service} ${arrow} ${airport}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SavingsBreakdown({
  recommendation, baseline, destinationSlug, boroughName,
  outbound_transit, return_transit,
  postcodeDistrict, cabinBags, checkedBags, seatsTogether, party_size,
  combinations,
  savingCategory, schoolName,
  baselineIsRecommended, baselineAsItinerary,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const { aiResult } = useFlightInsights();
  const effectiveRecommendation = aiResult?.recommendedCombination ?? recommendation;

  if (!effectiveRecommendation || !baseline) return null;

  const destName        = DESTINATION_NAMES[destinationSlug] ?? destinationSlug;
  const borough         = boroughName ?? 'London';
  const baselineRounded = Math.round(baseline.total_cost_gbp / 10) * 10;

  // ── Adaptive headline ─────────────────────────────────────────────────────

  const schoolSuffix = schoolName ? ` with children at ${schoolName}` : '';
  const schoolAt     = schoolName ? ` at ${schoolName}` : '';

  const { line1, line2, amberNote } = (() => {
    if (savingCategory === 'significant') return {
      line1: `Most ${borough} families${schoolSuffix} flying ${destName} this half-term will pay around £${baselineRounded.toLocaleString('en-GB')}.`,
      line2: `We found the same trip for ${fmt(effectiveRecommendation.total_cost_gbp)}.`,
      amberNote: null as string | null,
    };
    if (savingCategory === 'modest') return {
      line1: `Prices for ${destName} this half-term are fairly consistent across most families${schoolSuffix}.`,
      line2: `The cheapest all-in option we found is ${fmt(effectiveRecommendation.total_cost_gbp)}.`,
      amberNote: null as string | null,
    };
    if (savingCategory === 'baseline_cheapest') return {
      line1: `The cheapest all-in option we found for ${schoolName ?? borough} families this half-term.`,
      line2: `${fmt(effectiveRecommendation.total_cost_gbp)} — here's the full breakdown.`,
      amberNote: `Note: with your current preferences, the standard Saturday ${AIRPORT_NAMES[baseline.baseline_airport] ?? baseline.baseline_airport} booking is similar in cost. Try adjusting bags or transport above.` as string | null,
    };
    // minimal
    return {
      line1: `You've picked a good window. ${destName} this half-term is consistently priced for families${schoolAt}.`,
      line2: `${fmt(effectiveRecommendation.total_cost_gbp)} is about as good as it gets — here's the full breakdown.`,
      amberNote: null as string | null,
    };
  })();

  // ── Detail lines per row ──────────────────────────────────────────────────

  // Flights
  const smartFlightTotal = effectiveRecommendation.outbound_fare_gbp + effectiveRecommendation.return_fare_gbp;

  const detFlightsSmart = [
    `${carrierName(effectiveRecommendation.outbound_carrier)} ${fmt(effectiveRecommendation.outbound_fare_gbp)} · ${carrierName(effectiveRecommendation.return_carrier)} ${fmt(effectiveRecommendation.return_fare_gbp)}`,
  ];
  const detFlightsBase = [
    `${carrierName(baseline.carrier)} · ${fmtShortDate(baseline.outbound_date)} · ${baseline.baseline_airport}`,
  ];

  // Bundle detection (simplified)
  const bundleApplied = (
    effectiveRecommendation.cabin_bag_cost_gbp +
    effectiveRecommendation.checked_bag_cost_gbp +
    effectiveRecommendation.seat_cost_gbp
  ) > (
    effectiveRecommendation.fare_plus_ancillary_gbp -
    effectiveRecommendation.outbound_fare_gbp -
    effectiveRecommendation.return_fare_gbp
  );

  const cabinIsEstimate = ['FR', 'W6'].includes(effectiveRecommendation.outbound_carrier) ||
                          ['FR', 'W6'].includes(effectiveRecommendation.return_carrier);
  const hasRyanair = effectiveRecommendation.outbound_carrier === 'FR' || effectiveRecommendation.return_carrier === 'FR';

  const carriersStr = effectiveRecommendation.outbound_carrier === effectiveRecommendation.return_carrier
    ? carrierName(effectiveRecommendation.outbound_carrier)
    : `${carrierName(effectiveRecommendation.outbound_carrier)} + ${carrierName(effectiveRecommendation.return_carrier)}`;

  // Cabin bags
  const detCabinSmart = [
    effectiveRecommendation.cabin_bag_cost_gbp === 0
      ? 'Included in fare'
      : `${cabinBags} bag${cabinBags !== 1 ? 's' : ''} per leg${cabinIsEstimate ? ' · estimated' : ''}`,
  ];
  const detCabinBase = [
    baseline.cabin_bag_cost_gbp === 0
      ? 'Included in fare'
      : `${cabinBags} bag${cabinBags !== 1 ? 's' : ''} per leg`,
  ];

  // Checked bags
  const detCheckedSmart = [
    effectiveRecommendation.checked_bag_cost_gbp === 0
      ? 'None'
      : `${checkedBags} bag${checkedBags !== 1 ? 's' : ''} per leg`,
  ];
  const detCheckedBase = [
    baseline.checked_bag_cost_gbp === 0
      ? 'None'
      : `${checkedBags} bag${checkedBags !== 1 ? 's' : ''} per leg`,
  ];

  // Seats
  const detSeatsSmart = [
    seatsTogether
      ? `${party_size} seats reserved · ${carriersStr}${hasRyanair ? ' · children free on Ryanair' : ''}${bundleApplied ? ' · bundle applied' : ''}`
      : 'No advance seat selection · family split risk',
  ];
  const detSeatsBase = [
    `seats · ${carrierName(baseline.carrier)}`,
  ];

  // London transport
  const detTransitSmart = [
    `↑ ${transitLabel(outbound_transit, effectiveRecommendation.origin_iata, 'to')} · ${fmt(effectiveRecommendation.outbound_transit_cost_gbp)}`,
    `↓ ${transitLabel(return_transit, effectiveRecommendation.ret_dest_iata, 'from')} · ${fmt(effectiveRecommendation.return_transit_cost_gbp)}`,
  ];
  const detTransitBase = [
    `↑ ${transitLabel(baseline.outbound_transit, baseline.baseline_airport, 'to')} · ${fmt(baseline.outbound_transit_cost_gbp)}`,
    `↓ ${transitLabel(baseline.return_transit, baseline.baseline_airport, 'from')} · ${fmt(baseline.return_transit_cost_gbp)}`,
  ];

  // Destination transfers
  const detDestSmart = [
    effectiveRecommendation.destination_transfer_cost_gbp === 0
      ? 'Not included'
      : `${effectiveRecommendation.out_dest_iata} airport · both ways`,
  ];
  const detDestBase = [
    baseline.destination_transfer_cost_gbp === 0
      ? 'Not included'
      : `${baseline.destination_iata} airport · both ways`,
  ];

  // ── Table rows ────────────────────────────────────────────────────────────

  const tableRows = [
    { label: 'Flights',               smart: smartFlightTotal,                             base: baseline.baseline_fare_gbp,                   smartDetail: detFlightsSmart,  baseDetail: detFlightsBase  },
    { label: 'Cabin bags',            smart: effectiveRecommendation.cabin_bag_cost_gbp,            base: baseline.cabin_bag_cost_gbp,                  smartDetail: detCabinSmart,    baseDetail: detCabinBase    },
    { label: 'Checked bags',          smart: effectiveRecommendation.checked_bag_cost_gbp,          base: baseline.checked_bag_cost_gbp,                smartDetail: detCheckedSmart,  baseDetail: detCheckedBase  },
    { label: 'Seats',                 smart: effectiveRecommendation.seat_cost_gbp,                 base: baseline.seat_cost_gbp,                       smartDetail: detSeatsSmart,    baseDetail: detSeatsBase    },
    { label: 'London transport',      smart: effectiveRecommendation.transit_cost_gbp,              base: baseline.transit_cost_gbp,                    smartDetail: detTransitSmart,  baseDetail: detTransitBase  },
    { label: 'Destination transfers', smart: effectiveRecommendation.destination_transfer_cost_gbp, base: baseline.destination_transfer_cost_gbp,       smartDetail: detDestSmart,     baseDetail: detDestBase     },
  ];

  return (
    <section className="flex flex-col gap-xl">

      {/* ── Section C: Expandable cost breakdown — hidden when baseline is recommended ── */}
      {!baselineIsRecommended && <div
        className="bg-white rounded-lg"
        style={{ padding: 24, boxShadow: '0 4px 12px rgba(13,92,99,0.08)' }}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="font-inter flex items-center"
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: '#004349',
            fontSize: 15,
            fontWeight: 600,
            gap: 8,
          }}
        >
          <span style={{ fontSize: 18, lineHeight: 1, marginRight: 4 }}>
            {expanded ? '−' : '+'}
          </span>
          How we calculated your saving
        </button>

        {expanded && (
          <div style={{ marginTop: 20, overflowX: 'auto' }}>
            <table className="w-full font-inter" style={{ borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8ea' }}>
                  <th
                    className="text-left"
                    style={{ paddingBottom: 10, paddingRight: 24, color: '#6f797a', fontWeight: 500 }}
                  >
                    Component
                  </th>
                  <th
                    className="text-right"
                    style={{ paddingBottom: 10, paddingLeft: 16, paddingRight: 16, color: '#004349', fontWeight: 700 }}
                  >
                    Smart trip
                  </th>
                  <th
                    className="text-right"
                    style={{ paddingBottom: 10, paddingLeft: 16, color: '#9ba8a9', fontWeight: 500 }}
                  >
                    Saturday booking
                  </th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f2f4f4' }}>
                    <td style={{ padding: '10px 24px 10px 0', color: '#4a5758' }}>
                      {row.label}
                    </td>
                    <td className="text-right" style={{ padding: '10px 16px' }}>
                      <div style={{ color: '#004349', fontWeight: 600 }}>{fmt(row.smart)}</div>
                      {row.smartDetail.map((line, j) => (
                        <div key={j} style={{ fontSize: 11, color: '#3f484a', fontWeight: 400, marginTop: 2 }}>
                          {line}
                        </div>
                      ))}
                    </td>
                    <td className="text-right" style={{ padding: '10px 0 10px 16px' }}>
                      <div style={{ color: '#9ba8a9' }}>{fmt(row.base)}</div>
                      {row.baseDetail.map((line, j) => (
                        <div key={j} style={{ fontSize: 11, color: '#3f484a', fontWeight: 400, marginTop: 2 }}>
                          {line}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid #e2e8ea' }}>
                  <td style={{ padding: '12px 24px 4px 0', color: '#1a2b2c', fontWeight: 700 }}>
                    Total
                  </td>
                  <td
                    className="text-right"
                    style={{ padding: '12px 16px 4px', color: '#004349', fontWeight: 700 }}
                  >
                    {fmt(effectiveRecommendation.total_cost_gbp)}
                  </td>
                  <td
                    className="text-right"
                    style={{ padding: '12px 0 4px 16px', color: '#9ba8a9', fontWeight: 600 }}
                  >
                    {fmt(baseline.total_cost_gbp)}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Disclaimer */}
            <div style={{ marginTop: 16 }}>
              <p className="font-inter" style={{ fontSize: 11, color: '#9ba8a9', marginBottom: 6 }}>
                Typical Saturday booking: {carrierName(baseline.carrier)} · {baseline.baseline_airport} · {fmtShortDate(baseline.outbound_date)} → {fmtShortDate(baseline.return_date)} · {fmt(baseline.total_cost_gbp)}
              </p>
              <p className="font-inter" style={{ fontSize: 11, color: '#9ba8a9', lineHeight: 1.6, margin: 0 }}>
                Flight prices observed recently.<br />
                Bag fees for Ryanair and Wizz Air vary by route and demand — prices shown are estimates using published mid-range fees.<br />
                Uber costs are estimates based on typical pricing from {postcodeDistrict ?? 'your area'}.<br />
                Fines are estimates based on current borough penalty notice rates.
              </p>
            </div>
          </div>
        )}
      </div>}
    </section>
  );
}
