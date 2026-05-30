'use client';

function isEligible(
  scenario: any,
  windowStart: string,
  windowEnd: string
): boolean {
  // Rule 1: hard cap at 2 absence days
  if (scenario.total_absence_days > 2) return false

  // Rule 2: zero absence — always eligible
  if (scenario.total_absence_days === 0) return true

  // Rule 3: absence must be adjacent to the window.
  // The RPC correctly counts weekday-only absence days.
  // We trust departure_absence_days and return_absence_days from the RPC.
  // A scenario is adjacent if departure absence days account for ALL days
  // between departure and window_start, and return absence days account for
  // ALL days between window_end and return date.
  // Since the RPC already enforces this via calculate_absence_fine,
  // and the date ranges are now correctly constrained in the RPC,
  // any scenario returned with total_absence_days <= 2 is by definition adjacent.
  // The only remaining check: exclude scenarios where absence days are split
  // across both ends (departure AND return both have absence) unless uses_inset_day.

  if (scenario.departure_absence_days > 0 && scenario.return_absence_days > 0) {
    return scenario.uses_inset_day === true
  }

  return true
}

interface ComplianceCalculatorProps {
  data: {
    window_start: string
    window_end: string
    baseline_price: number
    scenarios: any[]
  }
  bestOutboundDate: string
  bestReturnDate: string
  tripType: string
}

const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtShort(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function gbp(n: number) {
  return `£${Math.round(Math.abs(n)).toLocaleString('en-GB')}`;
}

function getBaselineDates(windowStart: string, tripType: string) {
  const windowDate = new Date(windowStart + 'T00:00:00');
  const day  = windowDate.getDay();
  const diff = (day + 1) % 7; // days back to last Saturday (Sat=6 → 0, Sun=0 → 1, Mon=1 → 2 …)
  const dep  = new Date(windowDate);
  dep.setDate(windowDate.getDate() - diff);
  const minNights = tripType === 'circuit' ? 7 : 4;
  const ret = new Date(dep);
  ret.setDate(dep.getDate() + minNights);
  return {
    dep: dep.toISOString().split('T')[0],
    ret: ret.toISOString().split('T')[0],
  };
}

function cellStyle(saving: number, isAbsence: boolean, isOurPick: boolean) {
  let bg: string;
  let textDark = false;

  if (isAbsence) {
    bg = '#FAEEDA';
  } else if (saving >= 100) {
    bg = '#1D9E75';
    textDark = true;
  } else if (saving >= 51) {
    bg = '#5DCAA5';
  } else if (saving >= 1) {
    bg = '#9FE1CB';
  } else if (saving === 0) {
    bg = '#f2f4f4';
  } else {
    bg = '#F1EFE8';
  }

  const border = isOurPick
    ? '1.5px solid #004349'
    : isAbsence
    ? '1.5px solid #BA7517'
    : 'none';

  return { bg, border, textDark };
}

type DepSub =
  | { kind: 'inset' }
  | { kind: 'absence'; days: number }
  | { kind: 'window'; which: 'opens' | 'closes' }
  | null;

function getDepSub(eligible: any[], dep: string, windowStart: string, windowEnd: string): DepSub {
  const rows = eligible.filter((s) => s.departure_date === dep);
  if (rows.some((s) => s.uses_inset_day)) return { kind: 'inset' };
  const maxDays = Math.max(0, ...rows.map((s) => s.departure_absence_days ?? 0));
  if (maxDays > 0) return { kind: 'absence', days: maxDays };
  if (dep === windowStart) return { kind: 'window', which: 'opens' };
  if (dep === windowEnd)   return { kind: 'window', which: 'closes' };
  return null;
}

function getRetSub(eligible: any[], ret: string): number | null {
  const rows    = eligible.filter((s) => s.return_date === ret);
  const maxDays = Math.max(0, ...rows.map((s) => s.return_absence_days ?? 0));
  return maxDays > 0 ? maxDays : null;
}

// ── Cells ──────────────────────────────────────────────────────────────────────

function DataCell({ s, isRec }: { s: any; isRec: boolean }) {
  const isAbsence = s.requires_term_time_absence === true;
  const netSaving = s.net_saving_vs_baseline ?? 0;
  const hasFine   = (s.fine_gbp ?? 0) > 0;
  const { bg, border, textDark } = cellStyle(netSaving, isAbsence, isRec);
  const over = textDark ? '#04342C' : null;

  return (
    <td style={{ minWidth: 100, padding: 8, verticalAlign: 'top', background: bg, border, borderRadius: 6 }}>
      {isRec && (
        <div style={{ fontSize: '10px', fontWeight: 500, color: '#004349', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '3px' }}>
          <span style={{ fontSize: '12px' }}>★</span>
          <span style={{ letterSpacing: '0.05em', textTransform: 'uppercase' }}>Our pick</span>
        </div>
      )}
      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 600, color: over ?? '#191c1d', display: 'block' }}>
        {gbp(s.total_fare)}
      </span>
      {netSaving !== 0 && (
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: over ?? (netSaving > 0 ? '#0F6E56' : '#6f797a'), display: 'block' }}>
          {netSaving > 0 ? `+${gbp(netSaving)} saving` : `-${gbp(netSaving)}`}
        </span>
      )}
      {hasFine && (
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: over ?? '#BA7517', display: 'block' }}>
          Fine: {gbp(s.fine_gbp)}*
        </span>
      )}
    </td>
  );
}

function EmptyCell() {
  return (
    <td style={{ minWidth: 100, padding: 8, background: '#f2f4f4', borderRadius: 6, border: '1px solid #bfc8c9' }} />
  );
}

// ── Legend ─────────────────────────────────────────────────────────────────────

const LEGEND = [
  { bg: '#1D9E75', border: 'none',               label: '£100+ saving' },
  { bg: '#5DCAA5', border: 'none',               label: '£51–100 saving' },
  { bg: '#9FE1CB', border: 'none',               label: '£1–50 saving' },
  { bg: '#FAEEDA', border: '1.5px solid #BA7517', label: 'Term-time (fine applies)' },
  { bg: '#f2f4f4', border: '1px solid #bfc8c9',  label: 'No data / breakeven' },
];

// ── Main component ─────────────────────────────────────────────────────────────

export function ComplianceCalculator({ data, bestOutboundDate, bestReturnDate, tripType }: ComplianceCalculatorProps) {
  const eligible = data.scenarios.filter((s) =>
    isEligible(s, data.window_start, data.window_end)
  );

  const depDates = Array.from(new Set(eligible.map((s) => s.departure_date as string))).sort();
  const retDates = Array.from(new Set(eligible.map((s) => s.return_date as string))).sort();

  const cellMap = new Map<string, any>();
  eligible.forEach((s) => cellMap.set(`${s.departure_date}|${s.return_date}`, s));

  const baseline = getBaselineDates(data.window_start, tripType);

  const STICKY = { position: 'sticky' as const, left: 0, background: '#ffffff', zIndex: 10 };

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
        We've priced every viable departure and return combination for your half-term. Here's what each option actually costs — flights, fines included.
      </p>

      {eligible.length === 0 ? (
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#6f797a' }}>
          No eligible scenarios found for this window.
        </p>
      ) : (
        <>
          {/* Matrix */}
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '48px', background: 'linear-gradient(to right, transparent, var(--color-background-primary))', pointerEvents: 'none', zIndex: 20 }} />
          <div style={{ overflowX: 'auto', marginLeft: '-1.5rem', marginRight: '-1.5rem', paddingLeft: '1.5rem', paddingRight: '1.5rem' }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: '4px' }}>
              <thead>
                <tr>
                  {/* Corner */}
                  <th style={{ ...STICKY, minWidth: 130, padding: '0 16px 8px 0', verticalAlign: 'bottom', fontWeight: 'normal' }} />
                  {retDates.map((ret) => {
                    const absDays = getRetSub(eligible, ret);
                    return (
                      <th key={ret} style={{ minWidth: 100, padding: '0 8px 8px 8px', verticalAlign: 'bottom', textAlign: 'left', fontWeight: 'normal' }}>
                        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#6f797a', display: 'block', whiteSpace: 'nowrap' }}>
                          {fmtShort(ret)}
                        </span>
                        {absDays !== null && (
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: '#BA7517', display: 'block', whiteSpace: 'nowrap' }}>
                            {absDays} absence {absDays === 1 ? 'day' : 'days'}
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {/* ── Baseline reference row ── */}
                <tr>
                  <td style={{ ...STICKY, padding: '8px 16px 8px 0', verticalAlign: 'top', minWidth: 130 }}>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#6f797a', display: 'block' }}>
                      Baseline
                    </span>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#6f797a', display: 'block' }}>
                      Sat LHR, no optimisation
                    </span>
                  </td>
                  {retDates.map((ret) =>
                    ret === baseline.ret ? (
                      <td
                        key={ret}
                        style={{ minWidth: 100, padding: 8, verticalAlign: 'top', background: '#f2f4f4', border: '1px solid #bfc8c9', borderRadius: 6 }}
                      >
                        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 600, color: '#6f797a', display: 'block' }}>
                          {gbp(data.baseline_price)}
                        </span>
                        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: '#6f797a', display: 'block' }}>
                          What most families pay
                        </span>
                      </td>
                    ) : (
                      <EmptyCell key={ret} />
                    )
                  )}
                </tr>

                {/* ── Separator ── */}
                <tr aria-hidden="true">
                  <td colSpan={retDates.length + 1} style={{ height: 2, padding: 0 }} />
                </tr>

                {/* ── Departure rows ── */}
                {depDates.map((dep) => {
                  const sub = getDepSub(eligible, dep, data.window_start, data.window_end);
                  return (
                    <tr key={dep}>
                      <td style={{ ...STICKY, padding: '8px 16px 8px 0', verticalAlign: 'top', minWidth: 130 }}>
                        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, color: '#191c1d', display: 'block', whiteSpace: 'nowrap' }}>
                          {fmtShort(dep)}
                        </span>
                        {sub?.kind === 'inset' && (
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#0F6E56', display: 'block' }}>
                            Inset day
                          </span>
                        )}
                        {sub?.kind === 'absence' && (
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#BA7517', display: 'block' }}>
                            {sub.days} absence {sub.days === 1 ? 'day' : 'days'}
                          </span>
                        )}
                        {sub?.kind === 'window' && (
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#6f797a', display: 'block' }}>
                            Window {sub.which}
                          </span>
                        )}
                      </td>
                      {retDates.map((ret) => {
                        const s   = cellMap.get(`${dep}|${ret}`);
                        const isRec = dep === bestOutboundDate && ret === bestReturnDate;
                        return s
                          ? <DataCell key={ret} s={s} isRec={isRec} />
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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 16, paddingTop: 12, borderTop: '1px solid #e6e8e8' }}>
            {LEGEND.map(({ bg, border, label }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 14, height: 14, borderRadius: 3, background: bg, border, flexShrink: 0 }} />
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#6f797a' }}>{label}</span>
              </div>
            ))}
          </div>

          {/* Disclaimer */}
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#6f797a', marginTop: 10 }}>
            Holiday Smart does not recommend term-time absence. Fines shown are estimates based on current borough penalty notice rates. *Fines are estimates based on £80/parent/child, rising to £160 if unpaid within 21 days.
          </p>
        </>
      )}
    </section>
  );
}
