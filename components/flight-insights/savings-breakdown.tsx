'use client';

import { useState } from 'react';
import type { AssembledCombination, AssembledBaseline } from '@/lib/flights/assembleRecommendation';

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
  party_size: number;
  combinations?: AssembledCombination[];
  savingCategory: 'significant' | 'modest' | 'minimal';
  schoolName: string | null;
}

// ── Lookups ───────────────────────────────────────────────────────────────────

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
  cabinBags, checkedBags, party_size,
  combinations,
  savingCategory, schoolName,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  if (!recommendation || !baseline) return null;

  const destName        = DESTINATION_NAMES[destinationSlug] ?? destinationSlug;
  const borough         = boroughName ?? 'London';
  const baselineRounded = Math.round(baseline.total_cost_gbp / 10) * 10;

  // ── Adaptive headline ─────────────────────────────────────────────────────

  const schoolSuffix   = schoolName ? ` with children at ${schoolName}` : '';
  const schoolAt       = schoolName ? ` at ${schoolName}` : '';

  const { line1, line2 } = (() => {
    if (savingCategory === 'significant') return {
      line1: `Most ${borough} families${schoolSuffix} flying ${destName} this half-term will pay around £${baselineRounded.toLocaleString('en-GB')}.`,
      line2: `We found the same trip for ${fmt(recommendation.total_cost_gbp)}.`,
    };
    if (savingCategory === 'modest') return {
      line1: `Prices for ${destName} this half-term are fairly consistent across most families${schoolSuffix}.`,
      line2: `The cheapest all-in option we found is ${fmt(recommendation.total_cost_gbp)}.`,
    };
    return {
      line1: `You've picked a good window. ${destName} this half-term is consistently priced for families${schoolAt}.`,
      line2: `${fmt(recommendation.total_cost_gbp)} is about as good as it gets — here's the full breakdown.`,
    };
  })();

  // ── Detail lines per row ──────────────────────────────────────────────────

  // Flights
  const detFlightsSmart = [
    `${carrierName(recommendation.outbound_carrier)} ${fmt(recommendation.outbound_fare_gbp)} · ${carrierName(recommendation.return_carrier)} ${fmt(recommendation.return_fare_gbp)}`,
  ];
  const detFlightsBase = [
    `${carrierName(baseline.carrier)} · ${fmtShortDate(baseline.outbound_date)} · LHR`,
  ];

  // Cabin bags — append "· estimated" for FR or W6 carriers
  const cabinIsEstimate = ['FR', 'W6'].includes(recommendation.outbound_carrier) ||
                          ['FR', 'W6'].includes(recommendation.return_carrier);

  const detCabinSmart = [(() => {
    if (recommendation.cabin_bag_cost_gbp === 0 || cabinBags === 0) return 'Included in fare';
    const pl = cabinBags !== 1 ? 's' : '';
    const base = `${carrierName(recommendation.outbound_carrier)} + ${carrierName(recommendation.return_carrier)} · ${cabinBags} bag${pl} each leg`;
    return cabinIsEstimate ? `${base} · estimated` : base;
  })()];
  const detCabinBase = [(() => {
    if (baseline.cabin_bag_cost_gbp === 0 || cabinBags === 0) return 'Included in fare';
    const pl = cabinBags !== 1 ? 's' : '';
    const perBag = Math.round(baseline.cabin_bag_cost_gbp / cabinBags);
    return `${cabinBags} bag${pl} · £${perBag} each`;
  })()];

  // Checked bags
  const detCheckedSmart = [
    recommendation.checked_bag_cost_gbp === 0
      ? 'None included'
      : `${checkedBags} bag${checkedBags !== 1 ? 's' : ''} per leg`,
  ];
  const detCheckedBase = [
    baseline.checked_bag_cost_gbp === 0
      ? 'None included'
      : `${checkedBags} bag${checkedBags !== 1 ? 's' : ''} per leg`,
  ];

  // Seats
  const hasRyanair = recommendation.outbound_carrier === 'FR' || recommendation.return_carrier === 'FR';
  const detSeatsSmart = [
    `${carrierName(recommendation.outbound_carrier)} + ${carrierName(recommendation.return_carrier)} · ${party_size} seat${party_size !== 1 ? 's' : ''} · together${hasRyanair ? ' · children free on Ryanair' : ''}`,
  ];
  const detSeatsBase = [
    `${carrierName(baseline.carrier)} · ${party_size} seat${party_size !== 1 ? 's' : ''}`,
  ];

  // London transport
  const detTransitSmart = [
    `↑ ${transitLabel(outbound_transit, recommendation.origin_iata, 'to')} · ${fmt(recommendation.outbound_transit_cost_gbp)}`,
    `↓ ${transitLabel(return_transit, recommendation.ret_dest_iata, 'from')} · ${fmt(recommendation.return_transit_cost_gbp)}`,
  ];
  const detTransitBase = [
    `↑ ${transitLabel(baseline.outbound_transit, 'LHR', 'to')} · ${fmt(baseline.outbound_transit_cost_gbp)}`,
    `↓ ${transitLabel(baseline.return_transit, 'LHR', 'from')} · ${fmt(baseline.return_transit_cost_gbp)}`,
  ];

  // Destination transfers
  const detDestSmart = [
    recommendation.destination_transfer_cost_gbp === 0
      ? 'Not included'
      : `${recommendation.out_dest_iata} airport · both ways`,
  ];
  const detDestBase = [
    baseline.destination_transfer_cost_gbp === 0
      ? 'Not included'
      : `${baseline.destination_iata} airport · both ways`,
  ];

  // ── Table rows ────────────────────────────────────────────────────────────

  const tableRows = [
    { label: 'Flights',               smart: recommendation.outbound_fare_gbp + recommendation.return_fare_gbp, base: baseline.baseline_fare_gbp,                smartDetail: detFlightsSmart,  baseDetail: detFlightsBase  },
    { label: 'Cabin bags',            smart: recommendation.cabin_bag_cost_gbp,            base: baseline.cabin_bag_cost_gbp,            smartDetail: detCabinSmart,    baseDetail: detCabinBase    },
    { label: 'Checked bags',          smart: recommendation.checked_bag_cost_gbp,          base: baseline.checked_bag_cost_gbp,          smartDetail: detCheckedSmart,  baseDetail: detCheckedBase  },
    { label: 'Seats',                 smart: recommendation.seat_cost_gbp,                 base: baseline.seat_cost_gbp,                 smartDetail: detSeatsSmart,    baseDetail: detSeatsBase    },
    { label: 'London transport',      smart: recommendation.transit_cost_gbp,              base: baseline.transit_cost_gbp,              smartDetail: detTransitSmart,  baseDetail: detTransitBase  },
    { label: 'Destination transfers', smart: recommendation.destination_transfer_cost_gbp, base: baseline.destination_transfer_cost_gbp, smartDetail: detDestSmart,     baseDetail: detDestBase     },
  ];

  return (
    <section className="flex flex-col gap-xl">

      {/* ── Section A: Headline ─────────────────────────────────────────────── */}
      <div>
        <p
          className="font-newsreader"
          style={{ fontSize: 36, lineHeight: 1.2, color: '#191c1d', marginBottom: 12 }}
        >
          {line1}
        </p>
        <p
          className="font-newsreader"
          style={{ fontSize: 36, lineHeight: 1.2, color: '#191c1d', marginBottom: 16 }}
        >
          {line2}
        </p>
        <p className="font-inter" style={{ fontSize: 15, color: '#3f484a', fontWeight: 400 }}>
          We rebuilt the same week from scratch — different airport pairing, smarter seat and bag choices, optimised transfers.
        </p>
      </div>

      {/* ── Section B: Recommended itinerary ───────────────────────────────── */}
      <div
        className="bg-white rounded-lg"
        style={{
          padding: 24,
          boxShadow: '0 4px 12px rgba(13,92,99,0.08)',
          borderLeft: '4px solid #004349',
        }}
      >
        <p
          className="font-inter uppercase tracking-widest"
          style={{ fontSize: 11, color: '#004349', marginBottom: 16, fontWeight: 600 }}
        >
          Recommended itinerary
        </p>

        {/* Itinerary insight line */}
        {(() => {
          let insight = '';
          if (recommendation.is_inset_day) {
            insight = "Flying on your school's inset day — one day earlier than most families, at no extra cost.";
          } else if (!recommendation.requires_absence) {
            const cheapestInset = (combinations ?? [])
              .filter(c => c.is_inset_day && !c.requires_absence)
              .sort((a, b) => a.total_inc_fine - b.total_inc_fine)[0];
            if (cheapestInset) {
              const diff = Math.round(cheapestInset.total_inc_fine - recommendation.total_inc_fine);
              if (diff > 0 && diff <= 20) {
                insight = `Alternatively, fly the inset day (${fmtShortDate(cheapestInset.outbound_date)}) for just ${fmt(diff)} more and gain an extra day.`;
              }
            }
            if (!insight) insight = 'No school absence required for this trip.';
          }
          return insight ? (
            <p className="font-inter" style={{ fontSize: 13, color: '#3f484a', fontStyle: 'italic', marginBottom: 16 }}>
              {insight}
            </p>
          ) : null;
        })()}

        <div className="flex flex-col" style={{ gap: 10 }}>
          {/* Outbound row */}
          <div className="flex flex-wrap items-baseline" style={{ gap: 8 }}>
            <span className="font-inter" style={{ fontSize: 12, color: '#9ba8a9', width: 56, flexShrink: 0 }}>
              Outbound
            </span>
            <span className="font-inter" style={{ fontSize: 15, color: '#1a2b2c' }}>
              {fmtShortDate(recommendation.outbound_date)}
            </span>
            <span style={{ color: '#bfc8c9' }}>·</span>
            <span className="font-inter" style={{ fontSize: 15, color: '#1a2b2c' }}>
              {carrierName(recommendation.outbound_carrier)}
            </span>
            <span style={{ color: '#bfc8c9' }}>·</span>
            <span className="font-inter" style={{ fontSize: 15, color: '#1a2b2c' }}>
              from {recommendation.origin_iata}
            </span>
            {recommendation.outbound_departure_time && (
              <>
                <span style={{ color: '#bfc8c9' }}>·</span>
                <span className="font-inter" style={{ fontSize: 15, color: '#1a2b2c' }}>
                  departs {recommendation.outbound_departure_time}
                </span>
              </>
            )}
          </div>

          {/* Return row */}
          <div className="flex flex-wrap items-baseline" style={{ gap: 8 }}>
            <span className="font-inter" style={{ fontSize: 12, color: '#9ba8a9', width: 56, flexShrink: 0 }}>
              Return
            </span>
            <span className="font-inter" style={{ fontSize: 15, color: '#1a2b2c' }}>
              {fmtShortDate(recommendation.return_date)}
            </span>
            <span style={{ color: '#bfc8c9' }}>·</span>
            <span className="font-inter" style={{ fontSize: 15, color: '#1a2b2c' }}>
              {carrierName(recommendation.return_carrier)}
            </span>
            <span style={{ color: '#bfc8c9' }}>·</span>
            <span className="font-inter" style={{ fontSize: 15, color: '#1a2b2c' }}>
              to {recommendation.ret_dest_iata}
            </span>
            {recommendation.return_arrival_time && (
              <>
                <span style={{ color: '#bfc8c9' }}>·</span>
                <span className="font-inter" style={{ fontSize: 15, color: '#1a2b2c' }}>
                  arrives {recommendation.return_arrival_time}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Warning badges */}
        {(recommendation.family_split_risk || recommendation.requires_absence) && (
          <div className="flex flex-wrap" style={{ gap: 8, marginTop: 16 }}>
            {recommendation.family_split_risk && (
              <span
                className="font-inter"
                style={{
                  fontSize: 12,
                  background: '#fffbf0',
                  color: '#704b00',
                  border: '1px solid #fdba49',
                  borderRadius: 6,
                  padding: '3px 10px',
                }}
              >
                Family split risk
              </span>
            )}
            {recommendation.requires_absence && (
              <span
                className="font-inter"
                style={{
                  fontSize: 12,
                  background: '#fffbf0',
                  color: '#704b00',
                  border: '1px solid #fdba49',
                  borderRadius: 6,
                  padding: '3px 10px',
                }}
              >
                Requires school absence
                {recommendation.fine_gbp != null
                  ? ` · fine est. ${fmt(recommendation.fine_gbp)}`
                  : ''}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Section C: Expandable cost breakdown ────────────────────────────── */}
      <div
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
                    Baseline
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
                    {fmt(recommendation.total_cost_gbp)}
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
                Baseline: Saturday departure from Heathrow, {carrierName(baseline.carrier)}, no route optimisation.
              </p>
              <p className="font-inter" style={{ fontSize: 11, color: '#9ba8a9', lineHeight: 1.6, margin: 0 }}>
                Flight prices observed recently.<br />
                Bag fees for Ryanair and Wizz Air vary by route and demand — prices shown are estimates using published mid-range fees.<br />
                Uber costs are estimates based on typical pricing from your area.<br />
                Fines are estimates based on current borough penalty notice rates.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
