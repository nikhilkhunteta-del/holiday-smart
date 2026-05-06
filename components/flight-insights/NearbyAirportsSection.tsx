import type { NearbyAirportOption } from '@/types/flight';

interface Props { options: NearbyAirportOption[] }

function gbp(n: number) { return `£${n.toLocaleString('en-GB')}`; }

export function NearbyAirportsSection({ options }: Props) {
  const sorted = [...options].sort((a, b) => b.netSaving - a.netSaving);

  return (
    <section aria-labelledby="nearby-airports-heading">
      <div className="mb-lg">
        <span className="block font-inter text-label-sm uppercase tracking-widest text-primary-container mb-xs">
          Nearby Airports
        </span>
        <h2 id="nearby-airports-heading" className="font-newsreader text-headline-lg text-on-surface">
          Cheaper airports, short onward journey
        </h2>
        <p className="font-inter text-body-md text-on-surface-variant mt-sm max-w-xl">
          Budget carriers often fly into secondary airports near major cities. The onward transfer is usually fast and cheap — and the total still beats the direct option.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg">
        {sorted.map((opt) => (
          <div
            key={opt.id}
            className="bg-surface-container-lowest border border-outline-variant rounded-lg p-lg shadow-sm hover:shadow-md transition-shadow"
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-md flex-wrap gap-sm">
              <div>
                <div className="flex flex-wrap gap-xs mb-sm">
                  {opt.tags.map((t) => (
                    <span
                      key={t}
                      className="font-inter text-label-sm rounded-full px-sm py-xs"
                      style={{ background: 'rgba(95,141,84,0.1)', color: '#3d6b33' }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
                <p className="font-newsreader text-headline-md text-on-surface">
                  {opt.cheaperAirport} ({opt.cheaperAirportCode})
                </p>
                <p className="font-inter text-label-sm text-on-surface-variant">
                  for {opt.targetCity}
                </p>
              </div>
              <div className="text-right">
                <p className="font-inter text-label-sm text-outline mb-xs">Net saving</p>
                <p className="font-newsreader text-headline-md" style={{ color: '#3d6b33' }}>
                  {gbp(opt.netSaving)}
                </p>
              </div>
            </div>

            <div className="h-px bg-primary/20 mb-md" />

            {/* Comparison row */}
            <div className="grid grid-cols-2 gap-md mb-md">
              {/* Cheaper option */}
              <div className="rounded-md p-sm border-2 border-primary bg-primary/5">
                <p className="font-inter text-label-sm text-outline mb-xs">Fly to</p>
                <p className="font-inter text-body-md font-semibold text-primary">{opt.cheaperAirport}</p>
                <p className="font-inter text-label-sm text-on-surface-variant">
                  {gbp(Math.abs(opt.flightPriceDiff))} cheaper
                </p>
              </div>
              {/* vs direct */}
              <div className="rounded-md p-sm border border-outline-variant bg-surface-container-low">
                <p className="font-inter text-label-sm text-outline mb-xs">vs flying to</p>
                <p className="font-inter text-body-md font-medium text-on-surface-variant">{opt.mainAirport}</p>
                <p className="font-inter text-label-sm text-outline">{opt.mainAirportCode}</p>
              </div>
            </div>

            {/* Transfer details */}
            <div
              className="rounded-sm px-md py-sm font-inter text-label-sm flex items-start gap-sm"
              style={{ background: '#f0fafb', borderLeft: '3px solid #0d8a9a', color: '#004349' }}
            >
              <span aria-hidden="true">🚂</span>
              <span>
                <strong>{opt.onwardTransport}</strong> to {opt.targetCity} — {opt.onwardDuration}, {gbp(opt.onwardCost)} per person
              </span>
            </div>

            {/* Saving breakdown */}
            <div className="mt-md pt-md border-t border-outline-variant font-inter text-label-sm text-on-surface-variant flex items-center gap-md flex-wrap">
              <span>Flight saving: <strong className="text-on-surface">{gbp(Math.abs(opt.flightPriceDiff))}</strong></span>
              <span>−</span>
              <span>Transfer: <strong className="text-on-surface">{gbp(opt.onwardCost)}</strong>/person</span>
              <span>=</span>
              <span className="font-semibold" style={{ color: '#3d6b33' }}>Net: {gbp(opt.netSaving)}/person</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
