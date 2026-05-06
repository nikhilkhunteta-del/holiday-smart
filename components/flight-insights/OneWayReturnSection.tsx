import type { FareConfig, BookingConfig } from '@/types/flight';

interface Props {
  configs: FareConfig[];
  route: string;
  travelDate: string;
}

function gbp(n: number) { return `£${n.toLocaleString('en-GB')}`; }

const flexLabels: Record<FareConfig['flexibility'], { label: string; color: string }> = {
  low:    { label: 'Low flexibility',    color: '#ba1a1a' },
  medium: { label: 'Medium flexibility', color: '#805600' },
  high:   { label: 'High flexibility',   color: '#3d6b33' },
};

export function OneWayReturnSection({ configs, route, travelDate }: Props) {
  const sorted = [...configs].sort((a, b) => a.familyTotal - b.familyTotal);
  const cheapest = sorted[0].familyTotal;
  const mostExpensive = sorted[sorted.length - 1].familyTotal;

  return (
    <section aria-labelledby="ow-return-heading">
      <div className="mb-lg">
        <span className="block font-inter text-label-sm uppercase tracking-widest text-primary-container mb-xs">
          One-Way vs Return
        </span>
        <h2 id="ow-return-heading" className="font-newsreader text-headline-lg text-on-surface">
          Cheapest booking configuration
        </h2>
        <p className="font-inter text-body-md text-on-surface-variant mt-sm">
          {route} · {travelDate} · Automatically comparing single return vs two separate one-way tickets.
        </p>
      </div>

      {/* Best recommendation banner */}
      {sorted[0] && (
        <div
          className="flex items-center gap-md rounded-lg p-md mb-lg"
          style={{ background: 'rgba(253,186,73,0.12)', border: '1px solid rgba(253,186,73,0.35)' }}
        >
          <span className="font-inter text-body-md text-on-surface">
            <strong className="text-on-surface">Cheapest option:</strong> {sorted[0].label} at{' '}
            <strong className="text-primary">{gbp(sorted[0].familyTotal)}</strong> — saving{' '}
            <strong style={{ color: '#3d6b33' }}>{gbp(mostExpensive - cheapest)}</strong> vs the most expensive configuration.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-lg">
        {sorted.map((config, rank) => {
          const isRecommended = config.recommended;
          const saving = mostExpensive - config.familyTotal;

          return (
            <div
              key={config.id}
              className={[
                'bg-surface-container-lowest rounded-lg p-lg shadow-sm flex flex-col gap-md transition-shadow hover:shadow-md',
                isRecommended ? 'border-2 border-primary' : 'border border-outline-variant',
              ].join(' ')}
            >
              {/* Header */}
              <div>
                <div className="flex items-center justify-between mb-sm flex-wrap gap-sm">
                  <div className="flex items-center gap-sm flex-wrap">
                    <span
                      className="w-6 h-6 rounded-full flex items-center justify-center font-inter text-label-sm font-semibold flex-shrink-0"
                      style={rank === 0 ? { background: '#004349', color: '#ffffff' } : { background: '#eceeee', color: '#3f484a' }}
                    >
                      {rank + 1}
                    </span>
                    {isRecommended && (
                      <span
                        className="font-inter text-label-sm rounded-full px-sm py-xs"
                        style={{ background: 'rgba(253,186,73,0.2)', color: '#704b00' }}
                      >
                        ★ Recommended
                      </span>
                    )}
                  </div>
                  {saving > 0 && (
                    <span className="font-inter text-label-sm rounded-full px-sm py-xs" style={{ background: 'rgba(95,141,84,0.1)', color: '#3d6b33' }}>
                      Save {gbp(saving)}
                    </span>
                  )}
                </div>
                <p className="font-newsreader text-headline-md text-on-surface">{config.label}</p>
              </div>

              <div className="h-px bg-primary/20" />

              {/* Legs */}
              <div className="flex flex-col gap-xs font-inter text-body-md">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-label-sm text-outline mb-xs">Outbound</p>
                    <p className="font-medium text-on-surface">{config.outboundCarrier}</p>
                  </div>
                  <p className="font-semibold text-on-surface">{gbp(config.outboundPrice)}<span className="font-normal text-on-surface-variant text-label-sm">/pp</span></p>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-label-sm text-outline mb-xs">Return</p>
                    <p className="font-medium text-on-surface">{config.inboundCarrier}</p>
                  </div>
                  <p className="font-semibold text-on-surface">{gbp(config.inboundPrice)}<span className="font-normal text-on-surface-variant text-label-sm">/pp</span></p>
                </div>
              </div>

              <div className="h-px bg-outline-variant" />

              {/* Totals */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-inter text-label-sm text-outline mb-xs">Per person</p>
                  <p className="font-inter text-body-md font-semibold text-on-surface">{gbp(config.totalPerPerson)}</p>
                </div>
                <div className="text-right">
                  <p className="font-inter text-label-sm text-outline mb-xs">Family total</p>
                  <p className="font-newsreader text-headline-md text-primary">{gbp(config.familyTotal)}</p>
                </div>
              </div>

              {/* Flexibility */}
              <div className="flex items-center gap-sm">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: flexLabels[config.flexibility].color }}
                />
                <span className="font-inter text-label-sm" style={{ color: flexLabels[config.flexibility].color }}>
                  {flexLabels[config.flexibility].label}
                </span>
              </div>

              {/* Tags */}
              <div className="flex flex-wrap gap-xs">
                {config.tags.map((t) => (
                  <span
                    key={t}
                    className="font-inter text-label-sm rounded-full px-sm py-xs"
                    style={{ background: 'rgba(95,141,84,0.1)', color: '#3d6b33' }}
                  >
                    {t}
                  </span>
                ))}
              </div>

              {/* Notes */}
              <ul className="flex flex-col gap-xs">
                {config.notes.map((note) => (
                  <li key={note} className="flex items-start gap-xs font-inter text-label-sm text-on-surface-variant">
                    <span className="mt-px flex-shrink-0" style={{ color: '#6f797a' }}>·</span>
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
