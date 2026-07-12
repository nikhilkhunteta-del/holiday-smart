'use client';

import { useState } from 'react';
import { useFlightInsights, isAIPick } from './flight-insights-context';
import type { AssembledCombination, AssembledBaseline } from '@/lib/flights/assembleRecommendation';
import type { AirportTransitCost } from '@/lib/flights/transitCost';
import { LegOptionsModal, type SelectedCell } from './leg-options-modal';

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

// excess = c.total_cost_gbp - minCost (0 = cheapest → amber; higher = more expensive → teal)
function cellColour(excess: number): { bg: string; color: string } {
  if (excess < 1)    return { bg: '#fff3e0', color: '#5c310d' };
  if (excess < 50)   return { bg: '#a8d5d9', color: '#004349' };
  if (excess < 100)  return { bg: '#1a7a82', color: '#ffffff' };
  return                    { bg: '#0d5c63', color: '#ffffff' };
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface ComplianceCalculatorProps {
  combinations: AssembledCombination[];
  baseline: AssembledBaseline;
  recommendation: AssembledCombination | null;
  windowStart: string;
  windowEnd: string;
  partySize: number;
  adults: number;
  children: number;
  infants: number;
  pCabinBags: number;
  pCheckedBags: number;
  seatsTogether: boolean;
  baselineIsRecommended?: boolean;
  selectedOutbound?: string;
  selectedReturn?: string;
  combinationRange?: number | null;
  destinationSlug: string;
  schoolUrn: string;
  transportMode: string;
  postcodeDistrict: string;
}

// ── Baseline cell ──────────────────────────────────────────────────────────────

function BaselineCell({ total, isSelected, onClick }: { total: number; isSelected?: boolean; onClick?: () => void }) {
  return (
    <td
      onClick={onClick}
      style={{
        padding: 8, verticalAlign: 'top',
        background: '#f2f4f4',
        border: isSelected ? '2px solid #004349' : '1px solid #bfc8c9',
        borderRadius: 6,
        cursor: onClick ? 'pointer' : undefined,
      }}
    >
      {isSelected && (
        <span style={{
          fontFamily: 'Inter, sans-serif', fontSize: 9, fontWeight: 600,
          color: '#004349', display: 'block', letterSpacing: '0.05em',
          textTransform: 'uppercase', marginBottom: 2,
        }}>
          Viewing
        </span>
      )}
      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 600, color: '#6f797a', display: 'block' }}>{gbp(total)}</span>
      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 9, color: '#9ba8a9', display: 'block', letterSpacing: '0.05em', textTransform: 'uppercase', marginTop: 2 }}>Baseline</span>
    </td>
  );
}

// ── Data cell ──────────────────────────────────────────────────────────────────

function DataCell({
  c, minCost, isRec, isSelected, onClick, baselineNote,
}: {
  c: AssembledCombination;
  minCost: number;
  isRec: boolean;
  isSelected: boolean;
  onClick: () => void;
  baselineNote?: number;
}) {
  const saving    = c.total_cost_gbp - minCost;
  const { bg, color } = cellColour(saving);
  const labelColor = color === '#ffffff' ? 'rgba(255,255,255,0.85)' : '#004349';
  const border    = isSelected ? '2px solid #004349' : isRec ? '1.5px solid #004349' : 'none';
  const hasFine   = c.requires_absence && (c.fine_gbp ?? 0) > 0;

  // ── 5. Fine badge: label-sm (12px, 500) ───────────────────────────────────
  const fineBadge = hasFine ? (
    <span style={{
      display: 'inline-block', marginTop: 4,
      fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
      color: '#5c310d', background: '#fdba49', borderRadius: 9999, padding: '1px 6px',
    }}>
      Fine: {gbp(c.fine_gbp ?? 0)}
    </span>
  ) : null;

  const showOurPick = isRec;
  const showViewing = isSelected && !isRec;

  return (
    <td
      onClick={onClick}
      style={{ padding: 8, verticalAlign: 'top', background: bg, border, borderRadius: 6, cursor: 'pointer' }}
    >
      {(showOurPick || showViewing) ? (
        <div style={{ position: 'relative', overflow: 'hidden', paddingTop: 16 }}>
          {/* ── 4. Cheapest badge: no star, label-sm uppercase ────────────── */}
          <div style={{
            position: 'absolute', top: 0, left: 0,
            fontFamily: 'Inter, sans-serif',
            fontSize: 12, fontWeight: 500,
            color: showOurPick ? labelColor : '#004349',
            letterSpacing: '0.02em', textTransform: 'uppercase' as const,
            whiteSpace: 'nowrap' as const,
          }}>
            {showOurPick ? 'Cheapest' : 'Viewing'}
          </div>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 700, color, display: 'block' }}>
            {gbp(c.total_cost_gbp)}
          </span>
          {fineBadge}
          {baselineNote !== undefined && (
            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: labelColor === '#004349' ? '#6f797a' : 'rgba(255,255,255,0.7)', display: 'block', marginTop: 3 }}>
              vs baseline {gbp(baselineNote)}
            </span>
          )}
        </div>
      ) : (
        <>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 700, color, display: 'block' }}>
            {gbp(c.total_cost_gbp)}
          </span>
          {fineBadge}
          {baselineNote !== undefined && (
            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: '#6f797a', display: 'block', marginTop: 3 }}>
              vs baseline {gbp(baselineNote)}
            </span>
          )}
        </>
      )}
    </td>
  );
}

function invalidReason(dep: string, ret: string): string {
  if (ret <= dep) return 'Return must be after departure';
  if (nightsBetween(dep, ret) < 3) return 'Too short for this destination';
  return 'No flights found for this combination';
}

// ── 3. InvalidCell: blank, no dash ────────────────────────────────────────────

function InvalidCell({ dep, ret }: { dep: string; ret: string }) {
  return (
    <td
      title={invalidReason(dep, ret)}
      style={{
        background: '#f2f4f4',
        opacity: 0.5,
        borderRadius: 6,
        minHeight: 48,
        padding: 8,
        verticalAlign: 'top',
      }}
    />
  );
}

// ── Legend ─────────────────────────────────────────────────────────────────────

const LEGEND = [
  { bg: '#0d5c63', label: '£100+ saving' },
  { bg: '#1a7a82', label: '£50–100 saving' },
  { bg: '#a8d5d9', label: 'up to £50 saving' },
  { bg: '#fff3e0', label: 'more than cheapest option' },
];

// ── Amber label (shared style) ────────────────────────────────────────────────

const AMBER_LABEL = {
  fontFamily: 'Inter, sans-serif',
  fontSize: 10,
  color: '#BA7517',
  display: 'block',
  whiteSpace: 'nowrap' as const,
};

const AMBER_LABEL_WRAP = {
  ...AMBER_LABEL,
  whiteSpace: 'normal' as const,
};

// ── Main component ─────────────────────────────────────────────────────────────

export function ComplianceCalculator({
  combinations,
  baseline,
  recommendation,
  windowStart,
  windowEnd,
  partySize,
  adults,
  children,
  infants,
  pCabinBags,
  pCheckedBags,
  seatsTogether,
  baselineIsRecommended,
  selectedOutbound,
  selectedReturn,
  combinationRange,
  destinationSlug,
  schoolUrn,
  transportMode,
  postcodeDistrict,
}: ComplianceCalculatorProps) {
  const { aiResult }  = useFlightInsights();
  const aiRecommended = aiResult?.recommendedCombination ?? null;

  const [modalOpen, setModalOpen]       = useState(false);
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);

  const baselineTotal = baseline.total_cost_gbp;

  const cellMap = new Map<string, AssembledCombination>();
  for (const c of combinations) {
    const key = `${c.outbound_date}|${c.return_date}`;
    if (!cellMap.has(key)) cellMap.set(key, c);
  }

  // Include baseline dates in the matrix axes
  const allDepDates = new Set(combinations.map(c => c.outbound_date));
  if (baseline.outbound_date) allDepDates.add(baseline.outbound_date);
  const depDates = Array.from(allDepDates).sort();

  const allRetDates = new Set(combinations.map(c => c.return_date));
  if (baseline.return_date) allRetDates.add(baseline.return_date);
  const retDates = Array.from(allRetDates).sort();

  // ── 7. Row label column: 128px; secondary labels use on-surface-variant ──
  const LABEL_COL_WIDTH = 128;
  const STICKY = { position: 'sticky' as const, left: 0, zIndex: 10 };

  const blOut     = baseline.outbound_date ? fmtShort(baseline.outbound_date) : '';
  const blRet     = baseline.return_date   ? fmtShort(baseline.return_date)   : '';
  const blCarrier = carrierName(baseline.carrier ?? '');
  const blOrigin  = baseline.origin_iata ?? 'LHR';

  // ── Cheapest cost across all combinations (for colour coding) ────────────
  const minCost = Math.min(...combinations.map(c => c.total_cost_gbp));

  // ── 2. Dynamic price spread for subtitle ─────────────────────────────────
  const allTotals = combinations.map(c => c.total_cost_gbp);
  const priceSpread = allTotals.length >= 2
    ? Math.round(Math.max(...allTotals) - Math.min(...allTotals))
    : null;

  function handleCellClick(outbound_date: string, return_date: string) {
    const combo = cellMap.get(`${outbound_date}|${return_date}`);
    const isBaseline = outbound_date === baseline.outbound_date && return_date === baseline.return_date;
    const totalIncFine = combo?.total_inc_fine ?? (isBaseline ? baseline.total_cost_gbp : 0);
    const fineGbp = combo?.fine_gbp ?? 0;
    const requiresAbsence = combo?.requires_absence ?? false;
    setSelectedCell({
      outboundDate: outbound_date,
      returnDate: return_date,
      totalIncFine,
      fineGbp,
      requiresAbsence,
      label: `${fmtShort(outbound_date)} → ${fmtShort(return_date)}`,
    });
    setModalOpen(true);
  }

  const modalRecommendation = recommendation ? {
    outbound_carrier: recommendation.outbound_carrier ?? '',
    origin_iata:      recommendation.origin_iata ?? '',
    out_dest_iata:    recommendation.out_dest_iata ?? '',
    return_carrier:   recommendation.return_carrier ?? '',
    ret_dest_iata:    recommendation.ret_dest_iata ?? '',
  } : null;

  return (
    <section
      className="bg-white rounded-lg"
      style={{ padding: 24, boxShadow: '0 8px 16px rgba(13,92,99,0.08)' }}
      aria-labelledby="find-cheapest-dates-heading"
    >
      {/* ── 1. Title ── */}
      <h2
        id="find-cheapest-dates-heading"
        className="font-newsreader text-2xl font-medium mb-xs"
        style={{ color: '#004349' }}
      >
        Find your cheapest dates
      </h2>

      {/* ── 2. Subtitle — dynamic price spread ── */}
      <p className="font-inter mb-lg" style={{ fontSize: 14, color: '#6f797a' }}>
        {priceSpread != null && priceSpread > 0
          ? `£${priceSpread.toLocaleString('en-GB')} separates the cheapest and most expensive dates this half-term. Click any cell to see your options.`
          : 'Click any cell to see your flight options.'}
      </p>

      {combinations.length === 0 ? (
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#6f797a' }}>
          No combinations found for this window.
        </p>
      ) : (
        <>
          {/* Baseline reference line — hidden when baseline is the recommendation */}
          {!baselineIsRecommended && (
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#3f484a', marginBottom: 16 }}>
              Typical Saturday booking: {blCarrier} · {blOrigin} · {blOut}{blRet ? ` → ${blRet}` : ''} · {gbp(baselineTotal)} · no optimisation
            </p>
          )}

          {/* Matrix */}
          <div style={{ position: 'relative' }}>
            <div style={{
              position: 'absolute', right: 0, top: 0, bottom: 0, width: 48,
              background: 'linear-gradient(to right, transparent, #ffffff)',
              pointerEvents: 'none', zIndex: 20,
            }} />

            <div style={{ overflowX: 'auto', marginLeft: '-1.5rem', marginRight: '-1.5rem', paddingLeft: '1.5rem', paddingRight: '1.5rem' }}>
              <table style={{ borderCollapse: 'separate', borderSpacing: '4px', width: '100%', tableLayout: 'fixed' }}>
                <thead>
                  <tr>
                    {/* ── 7. Row label column: fixed 128px ── */}
                    <th style={{ ...STICKY, background: '#ffffff', width: LABEL_COL_WIDTH, padding: '0 16px 8px 0', verticalAlign: 'bottom', fontWeight: 'normal' }} />
                    {retDates.map((ret) => {
                      const retCombos   = combinations.filter(c => c.return_date === ret);
                      const allAbsence  = retCombos.length > 0 && retCombos.every(c => c.requires_absence);
                      const absenceDays = allAbsence ? Math.max(...retCombos.map(c => c.absence_days)) : null;
                      const isBaselineRet = ret === baseline.return_date;
                      return (
                        <th key={ret} style={{ padding: '0 8px 8px 8px', verticalAlign: 'bottom', textAlign: 'left', fontWeight: 'normal' }}>
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#6f797a', display: 'block', whiteSpace: 'nowrap' }}>
                            {fmtShort(ret)}
                          </span>
                          {absenceDays !== null && (
                            <span style={AMBER_LABEL_WRAP}>
                              {absenceDays} absence {absenceDays === 1 ? 'day' : 'days'}
                            </span>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {depDates.map((dep, rowIdx) => {
                    const depCombos     = combinations.filter(c => c.outbound_date === dep);
                    const hasInset      = depCombos.some(c => c.is_inset_day);
                    const isWindowStart = dep === windowStart;
                    const isWindowEnd   = dep === windowEnd;
                    const daysAbsent    = dep < windowStart ? weekdaysBetween(dep, windowStart) : 0;

                    // ── 6. Zebra striping: even rows (0-indexed) get surface-container-low ──
                    const rowBg = rowIdx % 2 === 1 ? '#f2f4f4' : 'transparent';

                    return (
                      <tr key={dep} style={{ background: rowBg }}>
                        {/* ── 7. Row label cell ── */}
                        <td style={{
                          ...STICKY,
                          background: rowBg,
                          width: LABEL_COL_WIDTH,
                          padding: '8px 12px 8px 0',
                          verticalAlign: 'top',
                        }}>
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, color: '#191c1d', display: 'block', whiteSpace: 'nowrap' }}>
                            {fmtShort(dep)}
                          </span>
                          {/* ── 7. Secondary labels: label-sm, on-surface-variant ── */}
                          {hasInset && (
                            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500, color: '#3f484a', display: 'block' }}>
                              Inset day
                            </span>
                          )}
                          {daysAbsent > 0 && (
                            <span style={{ ...AMBER_LABEL, fontSize: 12, fontWeight: 500 }}>
                              {daysAbsent} absence {daysAbsent === 1 ? 'day' : 'days'}
                            </span>
                          )}
                          {isWindowStart && (
                            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500, color: '#3f484a', display: 'block' }}>
                              Window opens
                            </span>
                          )}
                          {isWindowEnd && (
                            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500, color: '#3f484a', display: 'block' }}>
                              Window closes
                            </span>
                          )}
                        </td>
                        {retDates.map((ret) => {
                          const c             = cellMap.get(`${dep}|${ret}`);
                          const isBaselinePos = dep === baseline.outbound_date && ret === baseline.return_date;

                          const isRec = baselineIsRecommended
                            ? false
                            : !!(isAIPick(
                                { outbound_date: dep, return_date: ret },
                                aiRecommended as AssembledCombination | null,
                              ) || (!aiRecommended && recommendation &&
                                dep === recommendation.outbound_date &&
                                ret === recommendation.return_date));

                          const isSelected = dep === selectedOutbound && ret === selectedReturn;

                          if (isBaselinePos && baselineIsRecommended) {
                            return (
                              <td
                                key={ret}
                                onClick={() => handleCellClick(dep, ret)}
                                style={{
                                  padding: 8, verticalAlign: 'top',
                                  background: '#0d5c63',
                                  border: isSelected ? '2px solid #004349' : 'none',
                                  borderRadius: 6, cursor: 'pointer',
                                }}
                              >
                                <div style={{ position: 'relative', overflow: 'hidden', paddingTop: 16 }}>
                                  {/* ── 4. Cheapest badge on baseline-rec cell ── */}
                                  <div style={{
                                    position: 'absolute', top: 0, left: 0,
                                    fontFamily: 'Inter, sans-serif',
                                    fontSize: 12, fontWeight: 500,
                                    color: 'rgba(255,255,255,0.85)',
                                    letterSpacing: '0.02em', textTransform: 'uppercase' as const,
                                    whiteSpace: 'nowrap' as const,
                                  }}>
                                    Cheapest
                                  </div>
                                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 700, color: '#ffffff', display: 'block' }}>
                                    {gbp(baselineTotal)}
                                  </span>
                                </div>
                              </td>
                            );
                          }

                          if (c) {
                            if (isBaselinePos && baseline.total_cost_gbp <= c.total_inc_fine) {
                              return (
                                <BaselineCell
                                  key={ret}
                                  total={baseline.total_cost_gbp}
                                  isSelected={isSelected}
                                  onClick={() => handleCellClick(dep, ret)}
                                />
                              );
                            }
                            return (
                              <DataCell
                                key={ret}
                                c={c}
                                minCost={minCost}
                                isRec={isRec}
                                isSelected={isSelected}
                                onClick={() => handleCellClick(c.outbound_date, c.return_date)}
                                baselineNote={isBaselinePos ? baseline.total_cost_gbp : undefined}
                              />
                            );
                          }
                          if (isBaselinePos) {
                            return (
                              <BaselineCell
                                key={ret}
                                total={baseline.total_cost_gbp}
                                isSelected={isSelected}
                                onClick={() => handleCellClick(dep, ret)}
                              />
                            );
                          }
                          return <InvalidCell key={ret} dep={dep} ret={ret} />;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Legend ── */}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #e6e8e8' }}>
            {/* ── 8. Swatches 16×16, legend text on-surface-variant ── */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              {LEGEND.map(({ bg, label }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 16, height: 16, borderRadius: 3, background: bg, flexShrink: 0 }} />
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500, color: '#3f484a' }}>{label}</span>
                </div>
              ))}
            </div>
            {/* ── 9. Small-print lines removed ── */}
          </div>
        </>
      )}

      <LegOptionsModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        selectedCell={selectedCell}
        destinationSlug={destinationSlug}
        schoolUrn={schoolUrn}
        adults={adults}
        children={children}
        infants={infants}
        cabinBags={pCabinBags}
        checkedBags={pCheckedBags}
        seatsTogether={seatsTogether}
        transportMode={transportMode}
        postcodeDistrict={postcodeDistrict}
        recommendation={modalRecommendation}
      />
    </section>
  );
}
