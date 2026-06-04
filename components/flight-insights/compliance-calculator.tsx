'use client';

import { useState, Fragment } from 'react';
import type { AssembledCombination, AssembledBaseline } from '@/lib/flights/assembleRecommendation';
import type { AirportTransitCost } from '@/lib/flights/transitCost';

// ── Formatters ────────────────────────────────────────────────────────────────

const DAYS      = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS    = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtShort(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function gbp(n: number) {
  return `£${Math.round(Math.abs(n)).toLocaleString('en-GB')}`;
}

function nightsBetween(outbound: string, ret: string): number {
  const d1 = new Date(outbound + 'T00:00:00');
  const d2 = new Date(ret + 'T00:00:00');
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

// Count weekdays strictly between fromIso and toIso (exclusive of both ends)
function weekdaysBetween(fromIso: string, toIso: string): number {
  const d = new Date(fromIso + 'T00:00:00');
  const end = new Date(toIso + 'T00:00:00');
  let count = 0;
  d.setDate(d.getDate() + 1);
  while (d < end) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

// ── Carrier names ─────────────────────────────────────────────────────────────

const CARRIER_NAMES: Record<string, string> = {
  BA: 'British Airways', U2: 'easyJet', FR: 'Ryanair', VY: 'Vueling',
  TP: 'TAP Air Portugal', W6: 'Wizz Air', IB: 'Iberia', AF: 'Air France',
  KL: 'KLM', LH: 'Lufthansa', OS: 'Austrian Airlines', AY: 'Finnair',
  EW: 'Eurowings', SK: 'SAS', VU: 'Volotea',
};

function carrierName(iata: string): string {
  return CARRIER_NAMES[iata] ?? iata;
}

// ── Transport detail ──────────────────────────────────────────────────────────

function transportDetail(transit: AirportTransitCost, airport: string, dir: '↑' | '↓'): string {
  const rs = transit.transit?.route_summary ?? '';
  let service: string;
  if (transit.recommended_mode === 'uber')      service = 'Uber';
  else if (rs.includes('National Express'))      service = 'National Express';
  else if (rs.includes('Stansted Express'))      service = 'Stansted Express';
  else if (rs.includes('Thameslink'))            service = 'Thameslink';
  else if (rs.includes('Gatwick Express'))       service = 'Gatwick Express';
  else                                           service = 'Bus';
  return dir === '↑' ? `${service} → ${airport}` : `${service} ← ${airport}`;
}

// ── Colour coding ─────────────────────────────────────────────────────────────

function cellColour(saving: number): { bg: string; color: string } {
  if (saving > 100)   return { bg: '#0d5c63', color: '#ffffff' };
  if (saving >= 50)   return { bg: '#1a7a82', color: '#ffffff' };
  if (saving >= 1)    return { bg: '#a8d5d9', color: '#004349' };
  if (saving > -0.5)  return { bg: '#e1e3e3', color: '#3f484a' };
  return                     { bg: '#fff3e0', color: '#5c310d' };
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface ComplianceCalculatorProps {
  combinations: AssembledCombination[];
  baseline: AssembledBaseline;
  recommendation: AssembledCombination | null;
  windowStart: string;
  windowEnd: string;
  destinationName: string;
  partySize: number;
  pCabinBags: number;
  pCheckedBags: number;
}

// ── Insights ──────────────────────────────────────────────────────────────────

type Insight = { category: string; title: string; body: string };

function computeInsights(
  combinations: AssembledCombination[],
  windowStart: string,
  destinationName: string,
): Insight[] {
  const insights: Insight[] = [];
  const noAbsence = combinations.filter(c => !c.requires_absence);

  // 1. Inset day extension
  const insetNoAbsence = noAbsence.filter(c => c.is_inset_day);
  const nonInset       = noAbsence.filter(c => !c.is_inset_day);
  if (insetNoAbsence.length > 0 && nonInset.length > 0) {
    const cheapestInset    = insetNoAbsence.reduce((m, c) => c.total_inc_fine < m.total_inc_fine ? c : m);
    const cheapestNonInset = nonInset.reduce((m, c) => c.total_inc_fine < m.total_inc_fine ? c : m);
    const diff = Math.round(cheapestInset.total_inc_fine - cheapestNonInset.total_inc_fine);
    if (diff <= 0) {
      insights.push({
        category: 'TIMING',
        title: 'Free extra day',
        body: `Flying on the inset day (${fmtShort(cheapestInset.outbound_date)}) costs ${gbp(Math.abs(diff))} less than flying on the first day of half-term — and gives your family an extra day in ${destinationName}.`,
      });
    } else if (diff <= 20) {
      insights.push({
        category: 'TIMING',
        title: `One extra day for ${gbp(diff)}`,
        body: `Flying on the inset day (${fmtShort(cheapestInset.outbound_date)}) costs just ${gbp(diff)} more but gives your family an extra day in ${destinationName}. Worth it?`,
      });
    }
  }

  // 2. Beat the crowd — window_start falls on Monday
  if (insights.length < 3) {
    const wDate = new Date(windowStart + 'T00:00:00');
    if (wDate.getDay() === 1) {
      const satIso = addDays(windowStart, -2);
      const tueIso = addDays(windowStart, 1);
      const satCombos = noAbsence.filter(c => c.outbound_date === satIso);
      const wdCombos  = noAbsence.filter(c => c.outbound_date === windowStart || c.outbound_date === tueIso);
      if (satCombos.length > 0 && wdCombos.length > 0) {
        const cheapSat = satCombos.reduce((m, c) => c.total_inc_fine < m.total_inc_fine ? c : m);
        const cheapWd  = wdCombos.reduce((m, c) => c.total_inc_fine < m.total_inc_fine ? c : m);
        const diff = Math.round(cheapSat.total_inc_fine - cheapWd.total_inc_fine);
        if (diff >= 30) {
          insights.push({
            category: 'SAVINGS',
            title: 'Leave later, pay less',
            body: `Most families fly the weekend before half-term. Departing ${fmtShort(cheapWd.outbound_date)} instead of ${fmtShort(cheapSat.outbound_date)} saves ${gbp(diff)} and avoids the rush.`,
          });
        }
      }
    }
  }

  // 3. Fine arithmetic
  if (insights.length < 3) {
    const absenceHighFine = combinations.filter(c => c.requires_absence && (c.fine_gbp ?? 0) >= 160);
    if (absenceHighFine.length > 0 && noAbsence.length > 0) {
      const cheapAbsence   = absenceHighFine.reduce((m, c) => c.total_inc_fine < m.total_inc_fine ? c : m);
      const cheapNoAbsence = noAbsence.reduce((m, c) => c.total_inc_fine < m.total_inc_fine ? c : m);
      const additional     = Math.round(cheapAbsence.total_inc_fine - cheapNoAbsence.total_inc_fine);
      if (additional > 0) {
        const suffix = additional > 200 ? 'Probably not worth it.' : 'Your call.';
        insights.push({
          category: 'PLANNING',
          title: 'Is the fine worth it?',
          body: `Flying ${cheapAbsence.absence_days} day${cheapAbsence.absence_days === 1 ? '' : 's'} early costs ${gbp(cheapAbsence.total_inc_fine)} including the ${gbp(cheapAbsence.fine_gbp ?? 0)} fine — ${gbp(additional)} more than staying within term dates. ${suffix}`,
        });
      }
    }
  }

  // 4. Flat pricing window — show if fewer than 2 insights so far
  if (insights.length < 2 && noAbsence.length > 0) {
    const totals = noAbsence.map(c => c.total_inc_fine);
    const range  = Math.round(Math.max(...totals) - Math.min(...totals));
    if (range <= 50) {
      insights.push({
        category: 'PLANNING',
        title: 'Prices are surprisingly flat',
        body: `The cheapest and most expensive no-fine options in your window are only ${gbp(range)} apart. Pick dates that suit your family — the cost difference is minimal.`,
      });
    }
  }

  // 5. Best value days — show if fewer than 3 insights so far
  if (insights.length < 3 && noAbsence.length > 0) {
    const byDow: Record<number, number[]> = {};
    for (const c of noAbsence) {
      const dow = new Date(c.outbound_date + 'T00:00:00').getDay();
      (byDow[dow] = byDow[dow] ?? []).push(c.total_inc_fine);
    }
    const avgs = Object.entries(byDow).map(([dow, costs]) => ({
      dow: Number(dow),
      avg: costs.reduce((a, b) => a + b, 0) / costs.length,
    }));
    if (avgs.length >= 2) {
      const sorted      = [...avgs].sort((a, b) => a.avg - b.avg);
      const cheapest    = sorted[0];
      const mostExp     = sorted[sorted.length - 1];
      const saving      = Math.round(mostExp.avg - cheapest.avg);
      insights.push({
        category: 'SAVINGS',
        title: `${DAYS_FULL[cheapest.dow]}s are cheapest to fly`,
        body: `${DAYS_FULL[cheapest.dow]} departures average ${gbp(cheapest.avg)} for your window — ${gbp(saving)} less than the most expensive day to leave.`,
      });
    }
  }

  return insights.slice(0, 3);
}

// ── Insight cards ─────────────────────────────────────────────────────────────

function InsightCards({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
      {insights.map((ins, i) => (
        <div
          key={i}
          style={{
            flex: '1 1 220px', minWidth: 200,
            background: '#ffffff', borderRadius: 12,
            boxShadow: '0 4px 12px rgba(13,92,99,0.08)',
            padding: 16,
          }}
        >
          <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#805600', letterSpacing: '0.08em', marginBottom: 6 }}>
            {ins.category}
          </div>
          <div className="font-newsreader" style={{ fontSize: 18, color: '#191c1d', lineHeight: 1.3, marginBottom: 8 }}>
            {ins.title}
          </div>
          <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#3f484a', lineHeight: 1.5 }}>
            {ins.body}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Expand panel ──────────────────────────────────────────────────────────────

function ExpandPanel({
  c, partySize, pCabinBags, pCheckedBags, onClose,
}: {
  c: AssembledCombination;
  partySize: number;
  pCabinBags: number;
  pCheckedBags: number;
  onClose: () => void;
}) {
  const nights     = nightsBetween(c.outbound_date, c.return_date);
  const hasFine    = (c.fine_gbp ?? 0) > 0;
  const outDetail  = transportDetail(c.outbound_transit, c.origin_iata, '↑');
  const retDetail  = transportDetail(c.return_transit, c.ret_dest_iata, '↓');
  const hasRyanair = c.outbound_carrier === 'FR' || c.return_carrier === 'FR';
  const cabinCost  = c.cabin_bag_cost_gbp ?? 0;
  const checkedCost = c.checked_bag_cost_gbp ?? 0;
  const destCost   = c.destination_transfer_cost_gbp ?? 0;

  type Row = { label: string; detail: string; value: string; amber?: boolean };

  const rows: Row[] = [
    {
      label: 'Flights',
      detail: `${carrierName(c.outbound_carrier)} ${c.origin_iata}→${c.out_dest_iata} · ${carrierName(c.return_carrier)} ${c.ret_dest_iata}→${c.origin_iata}`,
      value: gbp((c.outbound_fare_gbp ?? 0) + (c.return_fare_gbp ?? 0)),
    },
    {
      label: 'Cabin bags',
      detail: cabinCost === 0 || pCabinBags === 0
        ? 'Included in fare'
        : `${pCabinBags} bag${pCabinBags !== 1 ? 's' : ''} · ${carrierName(c.outbound_carrier)} + ${carrierName(c.return_carrier)}`,
      value: gbp(cabinCost),
    },
    {
      label: 'Checked bags',
      detail: checkedCost === 0 || pCheckedBags === 0
        ? 'None'
        : `${pCheckedBags} bag${pCheckedBags !== 1 ? 's' : ''} per leg`,
      value: gbp(checkedCost),
    },
    {
      label: 'Seats',
      detail: `${partySize} seat${partySize !== 1 ? 's' : ''} together${hasRyanair ? ' · children free on Ryanair' : ''}`,
      value: gbp(c.seat_cost_gbp ?? 0),
    },
    {
      label: 'London transport',
      detail: `${outDetail} · ${retDetail}`,
      value: gbp(c.transit_cost_gbp),
    },
    {
      label: 'Destination transfers',
      detail: destCost === 0 ? 'Not included' : `${c.out_dest_iata} airport · both ways`,
      value: gbp(destCost),
    },
    ...(hasFine ? [{
      label: 'Fine',
      detail: `${c.absence_days} day${c.absence_days === 1 ? '' : 's'} absence`,
      value: gbp(c.fine_gbp ?? 0),
      amber: true,
    }] : []),
  ];

  return (
    <div style={{ position: 'relative', background: '#ffffff', boxShadow: '0 8px 16px rgba(13,92,99,0.08)', padding: 16, borderRadius: '0 0 8px 8px' }}>
      <button
        onClick={onClose}
        style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#6f797a', lineHeight: 1, padding: '0 4px' }}
        aria-label="Close breakdown"
      >
        ×
      </button>

      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 600, color: '#004349', marginBottom: 12, paddingRight: 24 }}>
        {carrierName(c.outbound_carrier)} from {c.origin_iata} · {carrierName(c.return_carrier)} to {c.ret_dest_iata} · {nights} night{nights === 1 ? '' : 's'}
      </p>

      {rows.map(({ label, detail, value, amber }) => (
        <div
          key={label}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(80px, auto) 1fr auto',
            gap: '0 12px',
            alignItems: 'start',
            padding: amber ? '6px 8px' : '6px 0',
            borderBottom: '1px solid #f2f4f4',
            background: amber ? '#fff8e7' : 'transparent',
            borderRadius: amber ? 4 : 0,
          }}
        >
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#191c1d' }}>{label}</span>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#3f484a' }}>{detail}</span>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 700, color: '#191c1d', whiteSpace: 'nowrap', textAlign: 'right' }}>{value}</span>
        </div>
      ))}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(80px, auto) 1fr auto',
        gap: '0 12px',
        alignItems: 'center',
        padding: '10px 0 0',
        borderTop: '1.5px solid #004349',
        marginTop: 4,
      }}>
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 700, color: '#004349' }}>Total</span>
        <span />
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 700, color: '#004349', textAlign: 'right' }}>{gbp(c.total_inc_fine)}</span>
      </div>
    </div>
  );
}

// ── Data cell ──────────────────────────────────────────────────────────────────

function DataCell({
  c, baselineTotal, isRec, isActive, onClick,
}: {
  c: AssembledCombination;
  baselineTotal: number;
  isRec: boolean;
  isActive: boolean;
  onClick: () => void;
}) {
  const saving    = baselineTotal - c.total_inc_fine;
  const { bg, color } = cellColour(saving);
  const hasFine   = c.requires_absence && (c.fine_gbp ?? 0) > 0;
  const starColor = color === '#ffffff' ? 'rgba(255,255,255,0.85)' : '#004349';
  const border    = isActive || isRec ? '1.5px solid #004349' : 'none';

  return (
    <td
      onClick={onClick}
      style={{ minWidth: 80, padding: 8, verticalAlign: 'top', background: bg, border, borderRadius: 6, cursor: 'pointer' }}
    >
      {isRec && (
        <div style={{ fontSize: '10px', fontWeight: 500, color: starColor, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ fontSize: '11px' }}>★</span>
          <span style={{ letterSpacing: '0.05em', textTransform: 'uppercase' }}>Our pick</span>
        </div>
      )}
      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 700, color, display: 'block' }}>
        {gbp(c.total_inc_fine)}
      </span>
      {hasFine && (
        <span style={{
          display: 'inline-block', marginTop: 4,
          fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 500,
          color: '#5c310d', background: '#fdba49', borderRadius: 9999, padding: '1px 6px',
        }}>
          Fine: {gbp(c.fine_gbp ?? 0)}
        </span>
      )}
    </td>
  );
}

function EmptyCell() {
  return <td style={{ minWidth: 80, padding: 8, background: '#f2f4f4', borderRadius: 6 }} />;
}

// ── Legend ─────────────────────────────────────────────────────────────────────

const LEGEND = [
  { bg: '#0d5c63', label: '£100+ saving' },
  { bg: '#1a7a82', label: '£50–100 saving' },
  { bg: '#a8d5d9', label: 'up to £50 saving' },
  { bg: '#fff3e0', label: 'costs more than baseline' },
];

// ── Amber label (shared style) ────────────────────────────────────────────────

const AMBER_LABEL = {
  fontFamily: 'Inter, sans-serif',
  fontSize: 10,
  color: '#BA7517',
  display: 'block',
  whiteSpace: 'nowrap' as const,
};

// ── Main component ─────────────────────────────────────────────────────────────

export function ComplianceCalculator({
  combinations,
  baseline,
  recommendation,
  windowStart,
  windowEnd,
  destinationName,
  partySize,
  pCabinBags,
  pCheckedBags,
}: ComplianceCalculatorProps) {
  const [activeCell, setActiveCell] = useState<string | null>(null);

  const baselineTotal = baseline.total_cost_gbp;

  const cellMap = new Map<string, AssembledCombination>();
  for (const c of combinations) {
    const key = `${c.outbound_date}|${c.return_date}`;
    if (!cellMap.has(key)) cellMap.set(key, c);
  }

  const depDates = Array.from(new Set(combinations.map(c => c.outbound_date))).sort();
  const retDates = Array.from(new Set(combinations.map(c => c.return_date))).sort();

  const STICKY = { position: 'sticky' as const, left: 0, background: '#ffffff', zIndex: 10 };

  const blOut     = baseline.outbound_date ? fmtShort(baseline.outbound_date) : '';
  const blRet     = baseline.return_date   ? fmtShort(baseline.return_date)   : '';
  const blCarrier = carrierName(baseline.carrier ?? '');
  const blOrigin  = baseline.origin_iata ?? 'LHR';

  const insights = computeInsights(combinations, windowStart, destinationName);

  function handleCellClick(key: string) {
    setActiveCell((prev: string | null) => prev === key ? null : key);
  }

  return (
    <section
      className="bg-white rounded-lg"
      style={{ padding: 24, boxShadow: '0 8px 16px rgba(13,92,99,0.08)' }}
      aria-labelledby="when-you-fly-heading"
    >
      <h2
        id="when-you-fly-heading"
        className="font-newsreader text-2xl font-medium mb-xs"
        style={{ color: '#004349' }}
      >
        When you fly changes everything.
      </h2>
      <p className="font-inter mb-lg" style={{ fontSize: 14, color: '#6f797a' }}>
        Every viable departure and return combination for your half-term, fully priced — flights, bags, seats and transfers included.
      </p>

      {combinations.length === 0 ? (
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#6f797a' }}>
          No combinations found for this window.
        </p>
      ) : (
        <>
          {/* Baseline reference line */}
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#3f484a', marginBottom: 16 }}>
            Baseline: {blCarrier} · {blOrigin} · {blOut}{blRet ? ` → ${blRet}` : ''} · {gbp(baselineTotal)} · no optimisation
          </p>

          {/* Insight cards */}
          <InsightCards insights={insights} />

          {/* Matrix */}
          <div style={{ position: 'relative' }}>
            <div style={{
              position: 'absolute', right: 0, top: 0, bottom: 0, width: 48,
              background: 'linear-gradient(to right, transparent, #ffffff)',
              pointerEvents: 'none', zIndex: 20,
            }} />
            <div style={{ overflowX: 'auto', marginLeft: '-1.5rem', marginRight: '-1.5rem', paddingLeft: '1.5rem', paddingRight: '1.5rem' }}>
              <table style={{ borderCollapse: 'separate', borderSpacing: '4px' }}>
                <thead>
                  <tr>
                    <th style={{ ...STICKY, minWidth: 110, padding: '0 16px 8px 0', verticalAlign: 'bottom', fontWeight: 'normal' }} />
                    {retDates.map((ret) => {
                      const retCombos   = combinations.filter(c => c.return_date === ret);
                      const allAbsence  = retCombos.length > 0 && retCombos.every(c => c.requires_absence);
                      const absenceDays = allAbsence ? Math.max(...retCombos.map(c => c.absence_days)) : null;
                      const retFine     = allAbsence
                        ? retCombos.find(c => (c.fine_gbp ?? 0) > 0)?.fine_gbp ?? null
                        : null;
                      return (
                        <th key={ret} style={{ minWidth: 80, padding: '0 8px 8px 8px', verticalAlign: 'bottom', textAlign: 'left', fontWeight: 'normal' }}>
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#6f797a', display: 'block', whiteSpace: 'nowrap' }}>
                            {fmtShort(ret)}
                          </span>
                          {absenceDays !== null && (
                            <span style={AMBER_LABEL}>
                              {absenceDays} absence {absenceDays === 1 ? 'day' : 'days'}{retFine !== null ? ` · ${gbp(retFine)} fine included` : ''}
                            </span>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {depDates.map((dep) => {
                    const depCombos     = combinations.filter(c => c.outbound_date === dep);
                    const hasInset      = depCombos.some(c => c.is_inset_day);
                    const isWindowStart = dep === windowStart;
                    const isWindowEnd   = dep === windowEnd;
                    const activeRet     = retDates.find(ret => activeCell === `${dep}|${ret}`);
                    const activeComb    = activeRet ? cellMap.get(`${dep}|${activeRet}`) ?? null : null;

                    // Row absence: outbound departures before window_start
                    const daysAbsent = dep < windowStart ? weekdaysBetween(dep, windowStart) : 0;
                    const rowFine    = daysAbsent > 0
                      ? depCombos.find(c => c.requires_absence && (c.fine_gbp ?? 0) > 0)?.fine_gbp ?? null
                      : null;

                    return (
                      <Fragment key={dep}>
                        <tr>
                          <td style={{ ...STICKY, padding: '8px 16px 8px 0', verticalAlign: 'top', minWidth: 110 }}>
                            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, color: '#191c1d', display: 'block', whiteSpace: 'nowrap' }}>
                              {fmtShort(dep)}
                            </span>
                            {hasInset && (
                              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#004349', display: 'block' }}>
                                Inset day
                              </span>
                            )}
                            {daysAbsent > 0 && (
                              <span style={AMBER_LABEL}>
                                {daysAbsent} absence {daysAbsent === 1 ? 'day' : 'days'}{rowFine !== null ? ` · ${gbp(rowFine)} fine included` : ''}
                              </span>
                            )}
                            {isWindowStart && (
                              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#6f797a', display: 'block' }}>
                                Window opens
                              </span>
                            )}
                            {isWindowEnd && (
                              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#6f797a', display: 'block' }}>
                                Window closes
                              </span>
                            )}
                          </td>
                          {retDates.map((ret) => {
                            const c       = cellMap.get(`${dep}|${ret}`);
                            const cellKey = `${dep}|${ret}`;
                            const isRec   = recommendation
                              ? dep === recommendation.outbound_date && ret === recommendation.return_date
                              : false;
                            return c
                              ? <DataCell
                                  key={ret}
                                  c={c}
                                  baselineTotal={baselineTotal}
                                  isRec={isRec}
                                  isActive={activeCell === cellKey}
                                  onClick={() => handleCellClick(cellKey)}
                                />
                              : <EmptyCell key={ret} />;
                          })}
                        </tr>
                        {/* Inline expansion panel */}
                        <tr>
                          <td colSpan={retDates.length + 1} style={{ padding: 0 }}>
                            <div style={{
                              maxHeight: activeComb ? '600px' : '0',
                              overflow: 'hidden',
                              transition: 'max-height 0.25s ease',
                            }}>
                              {activeComb && (
                                <ExpandPanel
                                  c={activeComb}
                                  partySize={partySize}
                                  pCabinBags={pCabinBags}
                                  pCheckedBags={pCheckedBags}
                                  onClose={() => setActiveCell(null)}
                                />
                              )}
                            </div>
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Legend */}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #e6e8e8' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 8 }}>
              {LEGEND.map(({ bg, label }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 14, height: 14, borderRadius: 3, background: bg, flexShrink: 0 }} />
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#6f797a' }}>{label}</span>
                </div>
              ))}
            </div>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#6f797a', margin: 0 }}>
              Holiday Smart does not recommend term-time absence. Fines shown are estimates based on current borough penalty notice rates.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
