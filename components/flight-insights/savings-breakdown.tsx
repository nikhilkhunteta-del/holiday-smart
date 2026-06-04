'use client';

import { useState } from 'react';
import type { AssembledCombination, AssembledBaseline } from '@/lib/flights/assembleRecommendation';

// ── Interfaces kept for stability ─────────────────────────────────────────────

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
  p_cabin_bags: number;
  p_checked_bags: number;
  party_size: number;
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

// ── Tooltip component (value cells) ──────────────────────────────────────────

function CellTooltip({ text }: { text: string }) {
  return (
    <span className="relative group inline-block ml-1">
      <span
        className="cursor-help text-xs align-middle"
        style={{ color: '#bfc8c9' }}
      >
        ℹ
      </span>
      <div
        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10 leading-relaxed shadow-md"
        style={{
          width: 256,
          background: '#191c1d',
          color: '#f8fafa',
          fontSize: 12,
          borderRadius: 6,
          padding: '8px 10px',
        }}
      >
        {text}
      </div>
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SavingsBreakdown({
  recommendation, baseline, destinationSlug, boroughName,
  outbound_transit, return_transit,
  p_cabin_bags, p_checked_bags, party_size, adults,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  if (!recommendation || !baseline) return null;

  const destName        = DESTINATION_NAMES[destinationSlug] ?? destinationSlug;
  const borough         = boroughName ?? 'London';
  const baselineRounded = Math.round(baseline.total_cost_gbp / 10) * 10;

  // ── Per-column tooltip texts ──────────────────────────────────────────────

  // Flights
  const ttFlightsSmart = `${carrierName(recommendation.outbound_carrier)} ${fmt(recommendation.outbound_fare_gbp)} + ${carrierName(recommendation.return_carrier)} ${fmt(recommendation.return_fare_gbp)}`;
  const ttFlightsBase  = `${carrierName(baseline.carrier)} ${fmt(baseline.baseline_fare_gbp)} (Saturday LHR, round trip)`;

  // Cabin bags
  const ttCabinSmart = (() => {
    if (recommendation.cabin_bag_cost_gbp === 0 || p_cabin_bags === 0) return 'Included in fare';
    const pl = p_cabin_bags !== 1 ? 's' : '';
    const perBag = Math.round(recommendation.cabin_bag_cost_gbp / 2 / p_cabin_bags);
    return `${p_cabin_bags} bag${pl} — ${carrierName(recommendation.outbound_carrier)} £${perBag} + ${carrierName(recommendation.return_carrier)} £${perBag}`;
  })();
  const ttCabinBase = (() => {
    if (baseline.cabin_bag_cost_gbp === 0 || p_cabin_bags === 0) return 'Included in fare';
    const pl = p_cabin_bags !== 1 ? 's' : '';
    const perBag = Math.round(baseline.cabin_bag_cost_gbp / p_cabin_bags);
    return `${p_cabin_bags} bag${pl} at £${perBag} each`;
  })();

  // Checked bags
  const ttCheckedSmart = recommendation.checked_bag_cost_gbp === 0
    ? 'No checked bags'
    : `${p_checked_bags} bag${p_checked_bags !== 1 ? 's' : ''} per leg`;
  const ttCheckedBase = baseline.checked_bag_cost_gbp === 0
    ? 'No checked bags'
    : `${p_checked_bags} bag${p_checked_bags !== 1 ? 's' : ''} per leg`;

  // Seats
  const ttSeatsSmart = (() => {
    if (recommendation.seat_cost_gbp === 0) return 'Seats not reserved.';
    const perLeg = recommendation.seat_cost_gbp / 2;
    function legDetail(carrier: string): string {
      if (carrier === 'FR') {
        const perAdult = adults > 0 ? Math.round(perLeg / adults) : 0;
        return `adults only (£${perAdult} × ${adults})`;
      }
      const ps = party_size > 0 ? party_size : 1;
      return `£${Math.round(perLeg / ps)} × ${ps} people`;
    }
    return `Seats reserved together. ${carrierName(recommendation.outbound_carrier)}: ${legDetail(recommendation.outbound_carrier)}. ${carrierName(recommendation.return_carrier)}: ${legDetail(recommendation.return_carrier)}.`;
  })();
  const ttSeatsBase = (() => {
    if (baseline.seat_cost_gbp === 0) return 'Seats not reserved.';
    const ps = party_size > 0 ? party_size : 1;
    const perPerson = Math.round(baseline.seat_cost_gbp / 2 / ps);
    return `£${perPerson} × ${ps} people × 2 legs`;
  })();

  // London transport
  const ttTransitSmart = (() => {
    const outMode = outbound_transit?.recommended_mode === 'uber' ? 'Uber' : 'Public transport';
    const retMode = return_transit?.recommended_mode === 'uber' ? 'Uber' : 'Public transport';
    return `Outbound: ${outMode} to ${recommendation.origin_iata} ${fmt(recommendation.outbound_transit_cost_gbp)}. Return: ${retMode} from ${recommendation.ret_dest_iata} ${fmt(recommendation.return_transit_cost_gbp)}.`;
  })();
  const ttTransitBase = `Public transport to/from Heathrow. ${fmt(baseline.outbound_transit_cost_gbp)} out + ${fmt(baseline.return_transit_cost_gbp)} back.`;

  // Destination transfers
  const ttDestSmart = `Airport to city centre and back. ${recommendation.out_dest_iata} airport.`;
  const ttDestBase  = `Airport to city centre and back. ${baseline.destination_iata} airport.`;

  // ── Table rows ────────────────────────────────────────────────────────────

  const tableRows = [
    { label: 'Flights',               smart: recommendation.outbound_fare_gbp + recommendation.return_fare_gbp, base: baseline.baseline_fare_gbp,                smartTooltip: ttFlightsSmart, baseTooltip: ttFlightsBase },
    { label: 'Cabin bags',            smart: recommendation.cabin_bag_cost_gbp,            base: baseline.cabin_bag_cost_gbp,            smartTooltip: ttCabinSmart,   baseTooltip: ttCabinBase   },
    { label: 'Checked bags',          smart: recommendation.checked_bag_cost_gbp,          base: baseline.checked_bag_cost_gbp,          smartTooltip: ttCheckedSmart, baseTooltip: ttCheckedBase },
    { label: 'Seats',                 smart: recommendation.seat_cost_gbp,                 base: baseline.seat_cost_gbp,                 smartTooltip: ttSeatsSmart,   baseTooltip: ttSeatsBase   },
    { label: 'London transport',      smart: recommendation.transit_cost_gbp,              base: baseline.transit_cost_gbp,              smartTooltip: ttTransitSmart, baseTooltip: ttTransitBase },
    { label: 'Destination transfers', smart: recommendation.destination_transfer_cost_gbp, base: baseline.destination_transfer_cost_gbp, smartTooltip: ttDestSmart,    baseTooltip: ttDestBase    },
  ];

  return (
    <section className="flex flex-col gap-xl">

      {/* ── Section A: Headline ─────────────────────────────────────────────── */}
      <div>
        {/* Part 1 — narrative headline */}
        <p
          className="font-newsreader"
          style={{ fontSize: 36, lineHeight: 1.2, color: '#191c1d', marginBottom: 12 }}
        >
          Most {borough} families flying {destName} this half-term will pay{' '}
          around{' '}
          <span style={{ color: '#004349' }}>
            £{Math.round(baselineRounded).toLocaleString('en-GB')}
          </span>
          .
        </p>

        {/* Part 2 — smart price, same visual weight */}
        <p
          className="font-newsreader"
          style={{ fontSize: 36, lineHeight: 1.2, color: '#191c1d', marginBottom: 16 }}
        >
          We found the same trip for{' '}
          <span style={{ color: '#004349' }}>{fmt(recommendation.total_cost_gbp)}</span>.
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
                    <td
                      className="text-right"
                      style={{ padding: '10px 16px', color: '#004349', fontWeight: 600 }}
                    >
                      <span className="whitespace-nowrap">
                        {fmt(row.smart)}
                        <CellTooltip text={row.smartTooltip} />
                      </span>
                    </td>
                    <td
                      className="text-right"
                      style={{ padding: '10px 0 10px 16px', color: '#9ba8a9' }}
                    >
                      <span className="whitespace-nowrap">
                        {fmt(row.base)}
                        <CellTooltip text={row.baseTooltip} />
                      </span>
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
            <p className="font-inter" style={{ marginTop: 16, fontSize: 12, color: '#9ba8a9' }}>
              Baseline: Saturday departure from Heathrow, {carrierName(baseline.carrier)}, no route optimisation.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
