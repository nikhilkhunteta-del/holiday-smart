import type { MultiModalRoute } from '@/types/flight';

interface Props { routes: MultiModalRoute[]; partySize: number }

function gbp(n: number) { return `£${n.toLocaleString('en-GB')}`; }

const modeIcons: Record<string, string> = {
  eurostar: '🚄',
  train:    '🚂',
  ferry:    '⛴',
  flight:   '✈',
  bus:      '🚌',
};

const modeLabels: Record<string, string> = {
  eurostar: 'Eurostar',
  train:    'Train',
  ferry:    'Ferry',
  flight:   'Flight',
  bus:      'Coach',
};

export function MultiModalSection({ routes, partySize }: Props) {
  // Scale family totals (mock built for 4) to actual party
  const scaledRoutes = routes.map((r) => ({
    ...r,
    familyTotal: Math.round(r.familyTotal / 4 * partySize),
    saving:      Math.round(r.saving      / 4 * partySize),
  }));

  return (
    <section aria-labelledby="multimodal-heading">
      <div className="mb-lg">
        <span className="block font-inter text-label-sm uppercase tracking-widest text-primary-container mb-xs">
          Multi-Modal
        </span>
        <h2 id="multimodal-heading" className="font-newsreader text-headline-lg text-on-surface">
          Eurostar, ferry &amp; flight combinations
        </h2>
        <p className="font-inter text-body-md text-on-surface-variant mt-sm max-w-xl">
          Sometimes the best family journey isn&apos;t a single flight. Combining trains and ferries can beat on price, experience, and sanity.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg">
        {scaledRoutes.map((route) => (
          <div
            key={route.id}
            className="bg-surface-container-lowest border border-outline-variant rounded-lg p-lg shadow-sm hover:shadow-md transition-shadow flex flex-col gap-md"
          >
            {/* Header */}
            <div className="flex items-start justify-between flex-wrap gap-sm">
              <div>
                <div className="flex flex-wrap gap-xs mb-sm">
                  {route.tags.map((t) => (
                    <span
                      key={t}
                      className="font-inter text-label-sm rounded-full px-sm py-xs"
                      style={{ background: 'rgba(95,141,84,0.1)', color: '#3d6b33' }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
                <p className="font-newsreader text-headline-md text-on-surface">{route.label}</p>
              </div>
              <div className="text-right">
                <p className="font-newsreader text-headline-md text-primary">{gbp(route.familyTotal)}</p>
                <p className="font-inter text-label-sm" style={{ color: '#3d6b33' }}>
                  Saves {gbp(route.saving)}
                </p>
              </div>
            </div>

            <div className="h-px bg-primary/20" />

            {/* Journey legs */}
            <div className="flex flex-col gap-sm">
              {route.legs.map((leg, i) => (
                <div key={i} className="flex items-start gap-md">
                  <div
                    className="w-8 h-8 rounded-md flex items-center justify-center text-sm flex-shrink-0"
                    style={{ background: '#eceeee' }}
                    aria-hidden="true"
                  >
                    {modeIcons[leg.mode]}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between flex-wrap gap-sm">
                      <div>
                        <p className="font-inter text-body-md font-semibold text-on-surface">
                          {leg.from} → {leg.to}
                        </p>
                        <p className="font-inter text-label-sm text-on-surface-variant">
                          {modeLabels[leg.mode]} · {leg.carrier} · {leg.duration}
                        </p>
                        {leg.note && (
                          <p className="font-inter text-label-sm text-outline">{leg.note}</p>
                        )}
                      </div>
                      <span className="font-inter text-body-md font-semibold text-on-surface">{gbp(leg.cost)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="h-px bg-outline-variant" />

            {/* Journey stats */}
            <div className="grid grid-cols-3 gap-md font-inter text-label-sm">
              <div>
                <p className="text-outline mb-xs">Total time</p>
                <p className="font-medium text-on-surface">{route.totalJourneyTime}</p>
              </div>
              <div>
                <p className="text-outline mb-xs">Experience</p>
                <p className="font-medium text-on-surface">
                  {'★'.repeat(route.experienceScore)}{'☆'.repeat(5 - route.experienceScore)}
                </p>
              </div>
              <div>
                <p className="text-outline mb-xs">vs direct flight</p>
                <p className="font-medium" style={{ color: '#3d6b33' }}>
                  Save {gbp(route.saving)}
                </p>
              </div>
            </div>

            {/* Experience note */}
            <div
              className="rounded-sm px-md py-sm font-inter text-label-sm"
              style={{ background: '#f0fafb', borderLeft: '3px solid #0d8a9a', color: '#004349' }}
            >
              {route.experienceNote}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
