import type { OpenJawItinerary } from '@/types/flight';

interface Props { itineraries: OpenJawItinerary[] }

function gbp(n: number) { return `£${n.toLocaleString('en-GB')}`; }

export function OpenJawSection({ itineraries }: Props) {
  return (
    <section aria-labelledby="openjaw-heading">
      <div className="mb-lg">
        <span className="block font-inter text-label-sm uppercase tracking-widest text-primary-container mb-xs">
          Open-Jaw &amp; Multi-City
        </span>
        <h2 id="openjaw-heading" className="font-newsreader text-headline-lg text-on-surface">
          Fly in one city, home from another
        </h2>
        <p className="font-inter text-body-md text-on-surface-variant mt-sm max-w-xl">
          Open-jaw itineraries let you explore a region linearly — no backtracking to your arrival airport. Often cheaper than a direct return.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-lg">
        {itineraries.map((it) => (
          <div
            key={it.id}
            className="bg-surface-container-lowest border border-outline-variant rounded-lg p-lg shadow-sm hover:shadow-md transition-shadow flex flex-col gap-md"
          >
            {/* Header */}
            <div>
              <div className="flex flex-wrap gap-xs mb-sm">
                {it.tags.map((t) => (
                  <span
                    key={t}
                    className="font-inter text-label-sm rounded-full px-sm py-xs"
                    style={{ background: 'rgba(95,141,84,0.1)', color: '#3d6b33' }}
                  >
                    {t}
                  </span>
                ))}
              </div>
              <p className="font-newsreader text-headline-md text-on-surface">{it.label}</p>
            </div>

            <div className="h-px bg-primary/20" />

            {/* Outbound leg */}
            <div className="flex flex-col gap-xs">
              <p className="font-inter text-label-sm uppercase tracking-wider text-outline">Outbound</p>
              <div className="flex items-center justify-between font-inter text-body-md">
                <span className="font-semibold text-on-surface">{it.outbound.from} → {it.outbound.to}</span>
                <span className="text-on-surface-variant">{it.outbound.time}</span>
              </div>
              <p className="font-inter text-label-sm text-on-surface-variant">{it.outbound.carrier} · {it.outbound.date}</p>
            </div>

            {/* Inbound leg */}
            <div className="flex flex-col gap-xs">
              <p className="font-inter text-label-sm uppercase tracking-wider text-outline">Return</p>
              <div className="flex items-center justify-between font-inter text-body-md">
                <span className="font-semibold text-on-surface">{it.inbound.from} → {it.inbound.to}</span>
                <span className="text-on-surface-variant">{it.inbound.time}</span>
              </div>
              <p className="font-inter text-label-sm text-on-surface-variant">{it.inbound.carrier} · {it.inbound.date}</p>
            </div>

            <div className="h-px bg-outline-variant" />

            {/* Pricing */}
            <div className="flex items-center justify-between">
              <div>
                <p className="font-inter text-label-sm text-outline mb-xs">Family total</p>
                <p className="font-newsreader text-headline-md text-primary">{gbp(it.familyTotal)}</p>
              </div>
              {it.savingVsDirect > 0 && (
                <span
                  className="font-inter text-label-sm rounded-full px-md py-xs"
                  style={{ background: 'rgba(253,186,73,0.2)', color: '#704b00' }}
                >
                  Saves {gbp(it.savingVsDirect)}
                </span>
              )}
            </div>

            {/* Note */}
            <p className="font-inter text-label-sm text-on-surface-variant border-t border-outline-variant pt-md">
              {it.note}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
