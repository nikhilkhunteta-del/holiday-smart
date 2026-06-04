'use client';

import { useState, Fragment } from 'react';
import type { AssembledCombination, AssembledBaseline } from '@/lib/flights/assembleRecommendation';
import type { AirportTransitCost } from '@/lib/flights/transitCost';

// ── Formatters ────────────────────────────────────────────────────────────────

const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
  partySize: number;
  pCabinBags: number;
  pCheckedBags: number;
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
  const nights      = nightsBetween(c.outbound_date, c.return_date);
  const hasFine     = (c.fine_gbp ?? 0) > 0;
  const outDetail   = transportDetail(c.outbound_transit, c.origin_iata, '↑');
  const retDetail   = transportDetail(c.return_transit, c.ret_dest_iata, '↓');
  const hasRyanair  = c.outbound_carrier === 'FR' || c.return_carrier === 'FR';
  const cabinCost   = c.cabin_bag_cost_gbp ?? 0;
  const checkedCost = c.checked_bag_cost_gbp ?? 0;
  const destCost    = c.destination_transfer_cost_gbp ?? 0;

  const rowStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '8px 0',
    borderBottom: '1px solid #f2f4f4',
  };
  const labelStyle = { fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#191c1d' };
  const detailStyle = { fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#3f484a', marginTop: 2 };
  const costStyle = { fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 700, color: '#191c1d', whiteSpace: 'nowrap' as const, paddingLeft: 16, flexShrink: 0 };

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

      {/* Flights */}
      <div style={rowStyle}>
        <div style={{ flex: 1 }}>
          <div style={labelStyle}>Flights</div>
          <div style={detailStyle}>
            {carrierName(c.outbound_carrier)} {c.origin_iata}→{c.out_dest_iata} · {carrierName(c.return_carrier)} {c.out_dest_iata}←{c.ret_dest_iata}
          </div>
        </div>
        <div style={costStyle}>{gbp((c.outbound_fare_gbp ?? 0) + (c.return_fare_gbp ?? 0))}</div>
      </div>

      {/* Cabin bags */}
      <div style={rowStyle}>
        <div style={{ flex: 1 }}>
          <div style={labelStyle}>Cabin bags</div>
          <div style={detailStyle}>
            {cabinCost === 0 || pCabinBags === 0
              ? 'Included in fare'
              : `${pCabinBags} bag${pCabinBags !== 1 ? 's' : ''} · ${carrierName(c.outbound_carrier)} + ${carrierName(c.return_carrier)}`}
          </div>
        </div>
        <div style={costStyle}>{gbp(cabinCost)}</div>
      </div>

      {/* Checked bags */}
      <div style={rowStyle}>
        <div style={{ flex: 1 }}>
          <div style={labelStyle}>Checked bags</div>
          <div style={detailStyle}>
            {checkedCost === 0 || pCheckedBags === 0 ? 'None' : `${pCheckedBags} bag${pCheckedBags !== 1 ? 's' : ''} per leg`}
          </div>
        </div>
        <div style={costStyle}>{gbp(checkedCost)}</div>
      </div>

      {/* Seats */}
      <div style={rowStyle}>
        <div style={{ flex: 1 }}>
          <div style={labelStyle}>Seats</div>
          <div style={detailStyle}>
            {partySize} seat{partySize !== 1 ? 's' : ''} together{hasRyanair ? ' · children free on Ryanair' : ''}
          </div>
        </div>
        <div style={costStyle}>{gbp(c.seat_cost_gbp ?? 0)}</div>
      </div>

      {/* London transport */}
      <div style={rowStyle}>
        <div style={{ flex: 1 }}>
          <div style={labelStyle}>London transport</div>
          <div style={detailStyle}>↑ {outDetail} · {gbp(c.outbound_transit_cost_gbp)}</div>
          <div style={detailStyle}>↓ {retDetail} · {gbp(c.return_transit_cost_gbp)}</div>
        </div>
        <div style={costStyle}>{gbp(c.transit_cost_gbp)}</div>
      </div>

      {/* Destination transfers */}
      <div style={rowStyle}>
        <div style={{ flex: 1 }}>
          <div style={labelStyle}>Destination transfers</div>
          <div style={detailStyle}>{destCost === 0 ? 'Not included' : `${c.out_dest_iata} airport · both ways`}</div>
        </div>
        <div style={costStyle}>{gbp(destCost)}</div>
      </div>

      {/* Fine */}
      {hasFine && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px', borderRadius: 4, background: '#fff8e7', marginTop: 2 }}>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>Fine</div>
            <div style={detailStyle}>{c.absence_days} day{c.absence_days === 1 ? '' : 's'} absence</div>
          </div>
          <div style={costStyle}>{gbp(c.fine_gbp ?? 0)}</div>
        </div>
      )}

      {/* Total */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0 0', borderTop: '1.5px solid #004349', marginTop: 4 }}>
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 700, color: '#004349' }}>Total</span>
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 700, color: '#004349' }}>{gbp(c.total_inc_fine)}</span>
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
