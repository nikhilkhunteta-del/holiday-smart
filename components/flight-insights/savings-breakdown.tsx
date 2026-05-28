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
  data: SavingsData;
  adults: number;
  children: number;
}

function fmt(n: number) {
  return '£' + Math.round(n).toLocaleString('en-GB');
}

function fmtDate(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function SavingsBreakdown({ data, adults, children }: Props) {
  const hasAbsence = data.requires_absence;
  const heroSaving = hasAbsence ? data.net_yield : data.total_yield;
  const partySize  = adults + children;

  return (
    <section
      className="bg-white rounded-lg p-lg"
      style={{ boxShadow: '0 8px 16px rgba(13,92,99,0.08)' }}
    >
      {/* Eyebrow */}
      <p className="font-inter text-label-sm uppercase tracking-widest text-primary mb-md">
        Savings breakdown
      </p>

      {/* ── Headline numbers ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-md mb-lg">

        {/* Baseline */}
        <div className="flex flex-col gap-xs">
          <span className="font-inter text-label-sm text-outline uppercase tracking-widest">
            Baseline
          </span>
          <span
            className="font-newsreader text-display-md text-on-surface-variant line-through decoration-outline"
            style={{ textDecorationColor: '#bfc8c9' }}
          >
            {fmt(data.baseline_price)}
          </span>
          <span className="font-inter text-label-sm text-outline">
            Sat dep · LHR · {partySize} seats
          </span>
        </div>

        {/* Smart price */}
        <div className="flex flex-col gap-xs">
          <span className="font-inter text-label-sm text-primary uppercase tracking-widest">
            Smart price
          </span>
          <span className="font-newsreader text-display-md text-primary">
            {fmt(data.smart_price)}
          </span>
          <span className="font-inter text-label-sm text-on-surface-variant">
            {fmtDate(data.best_outbound_date)} → {fmtDate(data.best_return_date)}
          </span>
        </div>

        {/* Saving */}
        <div
          className="flex flex-col gap-xs rounded-md p-md"
          style={{ background: 'rgba(13,92,99,0.06)' }}
        >
          <span className="font-inter text-label-sm uppercase tracking-widest" style={{ color: '#004349' }}>
            {hasAbsence ? 'Net saving' : 'You save'}
          </span>
          <span className="font-newsreader text-display-lg" style={{ color: '#004349' }}>
            {fmt(heroSaving)}
          </span>
          {hasAbsence && (
            <span className="font-inter text-label-sm text-on-surface-variant">
              {fmt(data.total_yield)} gross · {fmt(data.fine_gbp)} fine
            </span>
          )}
        </div>
      </div>

      {/* ── Levers ─────────────────────────────────────────────────────────── */}
      <div className="border-t border-outline-variant pt-lg mb-lg">
        <p className="font-newsreader text-headline-md text-on-surface mb-md">
          How we got there
        </p>

        <div className="flex flex-col gap-sm">
          {data.levers.map((lever, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-sm px-md rounded-md"
              style={{
                background: lever.above_threshold ? 'rgba(253,186,73,0.08)' : '#f2f4f4',
                borderLeft: lever.above_threshold ? '3px solid #fdba49' : '3px solid transparent',
              }}
            >
              {/* Label + winner */}
              <div className="flex flex-col gap-xs min-w-0">
                <span className="font-inter text-label-md text-on-surface truncate">
                  {lever.label}
                </span>
                <span className="font-inter text-label-sm text-primary">
                  → {lever.winner}
                </span>
              </div>

              {/* Saving + threshold badge */}
              <div className="flex items-center gap-sm flex-shrink-0 ml-md">
                <span className="font-inter text-label-md text-on-surface">
                  {fmt(lever.saving)}
                </span>
                {lever.above_threshold ? (
                  <span
                    className="font-inter text-label-sm rounded-full px-sm py-xs"
                    style={{ background: '#fdba49', color: '#704b00' }}
                  >
                    Saves
                  </span>
                ) : (
                  <span className="font-inter text-label-sm text-outline rounded-full px-sm py-xs border border-outline-variant">
                    Below threshold
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Fine context (conditional) ─────────────────────────────────────── */}
      {hasAbsence && (
        <div
          className="rounded-md px-md py-sm flex flex-col gap-xs"
          style={{ background: '#fffbf0', borderLeft: '3px solid #fdba49' }}
        >
          <p className="font-inter text-label-md text-on-surface">
            This saving involves school absence
          </p>
          <div className="flex flex-wrap gap-md">
            {data.departure_absence_days > 0 && (
              <span className="font-inter text-label-sm text-on-surface-variant">
                {data.departure_absence_days} day{data.departure_absence_days !== 1 ? 's' : ''} early departure
              </span>
            )}
            {data.return_absence_days > 0 && (
              <span className="font-inter text-label-sm text-on-surface-variant">
                {data.return_absence_days} day{data.return_absence_days !== 1 ? 's' : ''} late return
              </span>
            )}
            <span className="font-inter text-label-sm text-on-surface-variant">
              Fine estimate: {fmt(data.fine_gbp)}{data.fine_is_estimate ? '*' : ''}
            </span>
          </div>
          {data.fine_is_estimate && (
            <p className="font-inter text-label-sm text-outline">
              * Fine amounts are estimates based on current borough penalty notice rates. Confirm with your school.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
