import type { CapacityWarning } from '@/types/flight';

interface Props { warning: CapacityWarning }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmt(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
function gbp(n: number) { return `£${n.toLocaleString('en-GB')}`; }

export function CapacityWarningSection({ warning }: Props) {
  const w = warning;
  const seatsShort = w.partySize - w.seatsRemaining;

  return (
    <section aria-labelledby="capacity-heading">
      <div className="mb-lg">
        <span className="block font-inter text-label-sm uppercase tracking-widest text-primary-container mb-xs">
          Seat Availability
        </span>
        <h2 id="capacity-heading" className="font-newsreader text-headline-lg text-on-surface">
          Fare bucket alert
        </h2>
      </div>

      <div
        className="bg-surface-container-lowest border rounded-lg p-lg shadow-sm"
        style={{ borderColor: 'rgba(186,26,26,0.3)' }}
      >
        {/* Alert banner */}
        <div
          className="flex items-start gap-md rounded-md p-md mb-lg"
          style={{ background: 'rgba(186,26,26,0.06)', border: '1px solid rgba(186,26,26,0.2)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ba1a1a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-px" aria-hidden="true">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <div>
            <p className="font-inter text-body-md font-semibold" style={{ color: '#ba1a1a' }}>
              Only {w.seatsRemaining} seats remain at this fare — your party needs {w.partySize}
            </p>
            <p className="font-inter text-label-sm mt-xs" style={{ color: '#6b0004' }}>
              {seatsShort} {seatsShort === 1 ? 'seat' : 'seats'} will price up to the next fare bucket, increasing your total cost.
            </p>
          </div>
        </div>

        {/* Fare comparison */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-lg mb-lg">
          {/* Current fare */}
          <div className="rounded-lg p-md border border-outline-variant bg-surface-container-low">
            <p className="font-inter text-label-sm uppercase tracking-wider text-outline mb-sm">Current fare bucket</p>
            <p className="font-newsreader text-headline-lg text-on-surface mb-xs">{gbp(w.farePrice)}<span className="font-inter text-body-md text-on-surface-variant font-normal"> /person</span></p>
            <p className="font-inter text-label-sm text-on-surface-variant mb-md">{w.fareClass}</p>
            <div className="flex gap-xs items-center">
              {Array.from({ length: w.partySize }).map((_, i) => (
                <div
                  key={i}
                  className="w-6 h-6 rounded-sm flex items-center justify-center font-inter text-label-sm"
                  style={i < w.seatsRemaining
                    ? { background: 'rgba(0,67,73,0.12)', color: '#004349' }
                    : { background: 'rgba(186,26,26,0.12)', color: '#ba1a1a' }
                  }
                  title={i < w.seatsRemaining ? 'Seat available at this fare' : 'Seat unavailable — will price up'}
                >
                  {i < w.seatsRemaining ? '✓' : '↑'}
                </div>
              ))}
              <span className="font-inter text-label-sm text-on-surface-variant ml-sm">
                {w.seatsRemaining}/{w.partySize} seats at {gbp(w.farePrice)}
              </span>
            </div>
          </div>

          {/* Next fare */}
          <div className="rounded-lg p-md border border-outline-variant bg-surface-container-lowest">
            <p className="font-inter text-label-sm uppercase tracking-wider text-outline mb-sm">Next fare bucket</p>
            <p className="font-newsreader text-headline-lg text-on-surface mb-xs">{gbp(w.nextFarePrice)}<span className="font-inter text-body-md text-on-surface-variant font-normal"> /person</span></p>
            <p className="font-inter text-label-sm text-on-surface-variant mb-md">{w.nextFareClass}</p>
            <p className="font-inter text-label-sm" style={{ color: '#ba1a1a' }}>
              {seatsShort}× {gbp(w.nextFarePrice)} = <strong>{gbp(w.nextFarePrice * seatsShort)}</strong> uplift
            </p>
          </div>
        </div>

        {/* True cost summary */}
        <div className="rounded-md p-md bg-surface-container-low border border-outline-variant">
          <p className="font-inter text-label-sm uppercase tracking-wider text-outline mb-sm">Your actual family total</p>
          <div className="flex flex-wrap items-center gap-md font-inter text-body-md">
            <span className="text-on-surface-variant">
              {w.seatsRemaining}× {gbp(w.farePrice)} + {seatsShort}× {gbp(w.nextFarePrice)}
            </span>
            <span className="text-outline">=</span>
            <span className="font-newsreader text-headline-md text-primary">
              {gbp(w.seatsRemaining * w.farePrice + seatsShort * w.nextFarePrice)}
            </span>
            <span className="font-inter text-label-sm rounded-full px-sm py-xs" style={{ background: 'rgba(186,26,26,0.08)', color: '#ba1a1a' }}>
              +{gbp(w.costImpact)} vs headline
            </span>
          </div>
        </div>

        {/* Route / date context */}
        <div className="flex flex-wrap gap-lg mt-md pt-md border-t border-outline-variant font-inter text-label-sm text-on-surface-variant">
          <span>{w.carrier}</span>
          <span>{w.route}</span>
          <span>Depart {fmt(w.departureDate)}</span>
        </div>
      </div>
    </section>
  );
}
