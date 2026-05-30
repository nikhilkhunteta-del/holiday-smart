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

// ── Sub-label helpers ─────────────────────────────────────────────────────────

type DepSubLabel = { kind: 'inset' } | { kind: 'absence'; days: number } | null;

function depSubLabel(eligible: any[], dep: string): DepSubLabel {
  const rows = eligible.filter((s) => s.departure_date === dep);
  if (rows.some((s) => s.uses_inset_day)) return { kind: 'inset' };
  const maxDays = Math.max(0, ...rows.map((s) => s.departure_absence_days ?? 0));
  return maxDays > 0 ? { kind: 'absence', days: maxDays } : null;
}

function retSubLabel(eligible: any[], ret: string): number | null {
  const rows = eligible.filter((s) => s.return_date === ret);
  const maxDays = Math.max(0, ...rows.map((s) => s.return_absence_days ?? 0));
  return maxDays > 0 ? maxDays : null;
}

// ── Cell ──────────────────────────────────────────────────────────────────────

function Cell({ s, isRec }: { s: any; isRec: boolean }) {
  const isTerm    = s.requires_term_time_absence === true;
  const netSaving = s.net_saving_vs_baseline ?? 0;
  const hasFine   = (s.fine_gbp ?? 0) > 0;

  const bg = isTerm ? 'rgba(253,186,73,0.10)' : isRec ? 'rgba(13,92,99,0.08)' : '#ffffff';
  const border = isRec ? '1.5px solid #004349' : '1px solid #e6e8e8';

  return (
    <td
      style={{
        minWidth: 110,
        padding: 8,
        verticalAlign: 'top',
        background: bg,
        border,
        borderRadius: 6,
      }}
    >
      {isRec && (
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: '#004349', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 3 }}>
          Our pick
        </span>
      )}
      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 600, color: '#191c1d', display: 'block' }}>
        {gbp(s.total_fare)}
      </span>
      {netSaving !== 0 && (
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: netSaving > 0 ? '#004349' : '#6f797a', display: 'block' }}>
          {netSaving > 0 ? `+${gbp(netSaving)} saving` : `-${gbp(netSaving)}`}
        </span>
      )}
      {hasFine && (
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#805600', display: 'block' }}>
          Fine: {gbp(s.fine_gbp)}*
        </span>
      )}
    </td>
  );
}

function EmptyCell() {
  return (
    <td
      style={{
        minWidth: 110,
        padding: 8,
        verticalAlign: 'top',
        background: '#f2f4f4',
        border: '1px solid #e6e8e8',
        borderRadius: 6,
      }}
    />
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ComplianceCalculator({ data, bestOutboundDate, bestReturnDate }: ComplianceCalculatorProps) {
  const eligible = data.scenarios.filter((s) =>
    isEligible(s, data.window_start, data.window_end)
  );

  const depDates = Array.from(new Set(eligible.map((s) => s.departure_date as string))).sort();
  const retDates = Array.from(new Set(eligible.map((s) => s.return_date as string))).sort();

  const cellMap = new Map<string, any>();
  eligible.forEach((s) => cellMap.set(`${s.departure_date}|${s.return_date}`, s));

  const anyFine = eligible.some((s) => (s.fine_gbp ?? 0) > 0);

  return (
    <section
      className="bg-white rounded-lg"
      style={{ padding: 24, boxShadow: '0 8px 16px rgba(13,92,99,0.08)' }}
      aria-labelledby="find-your-window-heading"
    >
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
          {/* ── Matrix ──────────────────────────────────────────────────────── */}
          <div className="overflow-x-auto -mx-6 px-6">
            <table style={{ borderCollapse: 'separate', borderSpacing: '5px 5px' }}>
              <thead>
                <tr>
                  {/* Top-left corner — sticky, blank */}
                  <th
                    style={{
                      position: 'sticky',
                      left: 0,
                      background: '#ffffff',
                      zIndex: 10,
                      minWidth: 130,
                      padding: '0 16px 8px 0',
                      verticalAlign: 'bottom',
                      fontWeight: 'normal',
                    }}
                  />
                  {retDates.map((ret) => {
                    const absenceDays = retSubLabel(eligible, ret);
                    return (
                      <th
                        key={ret}
                        style={{
                          minWidth: 110,
                          padding: '0 8px 8px 8px',
                          verticalAlign: 'bottom',
                          textAlign: 'left',
                          fontWeight: 'normal',
                        }}
                      >
                        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#6f797a', display: 'block', whiteSpace: 'nowrap' }}>
                          {fmtShort(ret)}
                        </span>
                        {absenceDays !== null && (
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#805600', display: 'block', whiteSpace: 'nowrap' }}>
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
                  const sub = depSubLabel(eligible, dep);
                  return (
                    <tr key={dep}>
                      {/* Row header — sticky */}
                      <td
                        style={{
                          position: 'sticky',
                          left: 0,
                          background: '#ffffff',
                          zIndex: 10,
                          padding: '8px 16px 8px 0',
                          verticalAlign: 'top',
                          minWidth: 130,
                        }}
                      >
                        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 600, color: '#191c1d', display: 'block', whiteSpace: 'nowrap' }}>
                          {fmtShort(dep)}
                        </span>
                        {sub?.kind === 'inset' && (
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#004349', display: 'block' }}>
                            Inset day
                          </span>
                        )}
                        {sub?.kind === 'absence' && (
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#805600', display: 'block' }}>
                            {sub.days} absence {sub.days === 1 ? 'day' : 'days'}
                          </span>
                        )}
                      </td>
                      {/* Data cells */}
                      {retDates.map((ret) => {
                        const s = cellMap.get(`${dep}|${ret}`);
                        const isRec = dep === bestOutboundDate && ret === bestReturnDate;
                        return s
                          ? <Cell key={ret} s={s} isRec={isRec} />
                          : <EmptyCell key={ret} />;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Disclaimer ──────────────────────────────────────────────────── */}
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #e6e8e8' }}>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#6f797a' }}>
              Holiday Smart does not recommend term-time absence. Fines shown are estimates based on current borough penalty notice rates.
              {anyFine && ' *Fines are estimates based on £80/parent/child, rising to £160 if unpaid within 21 days.'}
            </p>
          </div>
        </>
      )}
    </section>
  );
}
