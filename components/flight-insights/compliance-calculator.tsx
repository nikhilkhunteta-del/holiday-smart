'use client';

import type { AssembledCombination } from '@/lib/flights/assembleRecommendation';

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

// ── Colour coding ─────────────────────────────────────────────────────────────

function cellColour(saving: number): { bg: string; color: string } {
  if (saving > 100)   return { bg: '#0d5c63', color: '#ffffff' };
  if (saving >= 50)   return { bg: '#1a7a82', color: '#ffffff' };
  if (saving >= 1)    return { bg: '#a8d5d9', color: '#004349' };
  if (saving > -0.5)  return { bg: '#e1e3e3', color: '#3f484a' }; // ≈ breakeven
  return                     { bg: '#fff3e0', color: '#5c310d' };  // costs more
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface ComplianceCalculatorProps {
  combinations: AssembledCombination[];
  baselineTotal: number;
  recommendation: AssembledCombination | null;
  windowStart: string;
  windowEnd: string;
  baselineCarrier?: string;
}

// ── Cells ──────────────────────────────────────────────────────────────────────

function DataCell({
  c,
  baselineTotal,
  isRec,
}: {
  c: AssembledCombination;
  baselineTotal: number;
  isRec: boolean;
}) {
  const saving = baselineTotal - c.total_inc_fine;
  const { bg, color } = cellColour(saving);
  const hasFine = c.requires_absence && (c.fine_gbp ?? 0) > 0;
  const starColor = color === '#ffffff' ? 'rgba(255,255,255,0.85)' : '#004349';
  const border = isRec ? '1.5px solid #004349' : 'none';

  return (
    <td style={{ minWidth: 100, padding: 8, verticalAlign: 'top', background: bg, border, borderRadius: 6 }}>
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
          display: 'inline-block',
          marginTop: 4,
          fontFamily: 'Inter, sans-serif',
          fontSize: 10,
          fontWeight: 500,
          color: '#5c310d',
          background: '#fdba49',
          borderRadius: 9999,
          padding: '1px 6px',
        }}>
          Fine: {gbp(c.fine_gbp ?? 0)}
        </span>
      )}
    </td>
  );
}

function EmptyCell() {
  return (
    <td style={{ minWidth: 100, padding: 8, background: '#f2f4f4', borderRadius: 6 }} />
  );
}

// ── Legend ─────────────────────────────────────────────────────────────────────

const LEGEND = [
  { bg: '#0d5c63', label: '£100+ saving' },
  { bg: '#1a7a82', label: '£50–100 saving' },
  { bg: '#a8d5d9', label: 'up to £50 saving' },
  { bg: '#fff3e0', label: 'costs more than baseline' },
];

// ── Main component ─────────────────────────────────────────────────────────────

export function ComplianceCalculator({
  combinations,
  baselineTotal,
  recommendation,
  windowStart,
  windowEnd,
  baselineCarrier = '',
}: ComplianceCalculatorProps) {
  // Build cheapest cell per (outbound_date, return_date) — combinations already sorted by total_inc_fine ASC
  const cellMap = new Map<string, AssembledCombination>();
  for (const c of combinations) {
    const key = `${c.outbound_date}|${c.return_date}`;
    if (!cellMap.has(key)) cellMap.set(key, c);
  }

  const depDates = Array.from(new Set(combinations.map(c => c.outbound_date))).sort();
  const retDates = Array.from(new Set(combinations.map(c => c.return_date))).sort();

  const STICKY = { position: 'sticky' as const, left: 0, background: '#ffffff', zIndex: 10 };

  const carrierDisplay = baselineCarrier ? `${baselineCarrier} from LHR` : 'from LHR';

  return (
    <section
      className="bg-white rounded-lg"
      style={{ padding: 24, boxShadow: '0 8px 16px rgba(13,92,99,0.08)' }}
      aria-labelledby="find-your-window-heading"
    >
      {/* Header */}
      <h2
        id="find-your-window-heading"
        className="font-newsreader text-2xl font-medium mb-xs"
        style={{ color: '#004349' }}
      >
        Find your window
      </h2>
      <p className="font-inter mb-lg" style={{ fontSize: 14, color: '#6f797a' }}>
        Each cell shows the cheapest all-in trip for those dates — flights, bags, seats and transfers included.
      </p>

      {combinations.length === 0 ? (
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#6f797a' }}>
          No combinations found for this window.
        </p>
      ) : (
        <>
          {/* Baseline reference line */}
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#3f484a', marginBottom: 16 }}>
            Baseline: {gbp(baselineTotal)} · {carrierDisplay} · Saturday · no optimisation
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
                    {/* Corner */}
                    <th style={{ ...STICKY, minWidth: 120, padding: '0 16px 8px 0', verticalAlign: 'bottom', fontWeight: 'normal' }} />
                    {retDates.map((ret) => {
                      const retCombos = combinations.filter(c => c.return_date === ret);
                      const allAbsence = retCombos.length > 0 && retCombos.every(c => c.requires_absence);
                      const absenceDays = allAbsence
                        ? Math.max(...retCombos.map(c => c.absence_days))
                        : null;
                      return (
                        <th key={ret} style={{ minWidth: 100, padding: '0 8px 8px 8px', verticalAlign: 'bottom', textAlign: 'left', fontWeight: 'normal' }}>
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#6f797a', display: 'block', whiteSpace: 'nowrap' }}>
                            {fmtShort(ret)}
                          </span>
                          {absenceDays !== null && (
                            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: '#BA7517', display: 'block', whiteSpace: 'nowrap' }}>
                              {absenceDays} absence {absenceDays === 1 ? 'day' : 'days'}
                            </span>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {depDates.map((dep) => {
                    const depCombos = combinations.filter(c => c.outbound_date === dep);
                    const hasInset      = depCombos.some(c => c.is_inset_day);
                    const isWindowStart = dep === windowStart;
                    const isWindowEnd   = dep === windowEnd;

                    return (
                      <tr key={dep}>
                        <td style={{ ...STICKY, padding: '8px 16px 8px 0', verticalAlign: 'top', minWidth: 120 }}>
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, color: '#191c1d', display: 'block', whiteSpace: 'nowrap' }}>
                            {fmtShort(dep)}
                          </span>
                          {hasInset && (
                            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#004349', display: 'block' }}>
                              Inset day
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
                          const c = cellMap.get(`${dep}|${ret}`);
                          const isRec = recommendation
                            ? dep === recommendation.outbound_date && ret === recommendation.return_date
                            : false;
                          return c
                            ? <DataCell key={ret} c={c} baselineTotal={baselineTotal} isRec={isRec} />
                            : <EmptyCell key={ret} />;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Legend */}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #e6e8e8' }}>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#6f797a', marginBottom: 8 }}>
              Colours show saving vs baseline ({gbp(baselineTotal)}). Each cell shows the cheapest all-in trip for those dates across all airlines and airports.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              {LEGEND.map(({ bg, label }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 14, height: 14, borderRadius: 3, background: bg, flexShrink: 0 }} />
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#6f797a' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Disclaimer */}
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#6f797a', marginTop: 10 }}>
            Holiday Smart does not recommend term-time absence. Fines shown are estimates based on current borough penalty notice rates.
          </p>
        </>
      )}
    </section>
  );
}
