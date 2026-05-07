import type { StopoverRoute, KidAgeFriction, Party } from '@/types/flight';

interface Props {
  routes: StopoverRoute[];
  destination: string;
  directPrice: number;
  party: Party;
}

function gbp(n: number) { return `£${n.toLocaleString('en-GB')}`; }

const frictionConfig: Record<KidAgeFriction, { label: string; icon: string; bg: string; color: string }> = {
  green: { label: 'Family-friendly',          icon: '✅', bg: 'rgba(95,141,84,0.1)',  color: '#3d6b33' },
  amber: { label: 'Fine for older kids (6+)', icon: '⚠️', bg: 'rgba(253,186,73,0.15)', color: '#704b00' },
  red:   { label: 'Not recommended under 6',  icon: '🚫', bg: 'rgba(186,26,26,0.08)', color: '#ba1a1a' },
};

// Escalate friction if any child is under 6
function escalateFriction(base: KidAgeFriction, childAges: number[]): KidAgeFriction {
  if (childAges.some((age) => age < 6)) {
    if (base === 'green') return 'amber';
    if (base === 'amber') return 'red';
  }
  return base;
}

export function StopoverSection({ routes, destination, directPrice, party }: Props) {
  const partySize = party.adults + party.children;
  // Scale family totals (mock built for 4) to actual party
  const scaledRoutes = routes.map((r) => {
    const familyTotal = r.totalPrice * partySize;
    const scaledDirect = Math.round(r.directFamilyTotal / 4 * partySize);
    const saving = scaledDirect - familyTotal;
    const kidAgeFriction = escalateFriction(r.kidAgeFriction, party.childAges);
    return { ...r, familyTotal, saving, kidAgeFriction };
  });
  const scaledDirectPrice = Math.round(directPrice / 4 * partySize);
  return (
    <section aria-labelledby="stopover-heading">
      <div className="mb-lg">
        <span className="block font-inter text-label-sm uppercase tracking-widest text-primary-container mb-xs">
          Stopover Routing
        </span>
        <h2 id="stopover-heading" className="font-newsreader text-headline-lg text-on-surface">
          Via routes — savings vs comfort
        </h2>
        <p className="font-inter text-body-md text-on-surface-variant mt-sm">
          Routes to {destination} via hub airports. Each includes a kid-age friction score — because a 9-hour layover with a 4-year-old is not the same as with a 10-year-old.
        </p>
      </div>

      {/* Direct baseline */}
      <div className="flex items-center gap-md rounded-md p-md mb-lg border border-outline-variant bg-surface-container-low font-inter text-body-md">
        <span className="text-on-surface-variant">Direct flight baseline:</span>
        <span className="font-semibold text-on-surface">{gbp(scaledDirectPrice)}</span>
        <span className="font-inter text-label-sm text-outline">family total</span>
      </div>

      <div className="flex flex-col gap-md">
        {scaledRoutes.map((r) => {
          const fc = frictionConfig[r.kidAgeFriction];
          return (
            <div
              key={r.id}
              className="bg-surface-container-lowest border border-outline-variant rounded-lg p-lg shadow-sm"
            >
              <div className="flex items-start justify-between flex-wrap gap-md mb-md">
                {/* Route info */}
                <div>
                  <div className="flex items-center gap-sm flex-wrap mb-xs">
                    <p className="font-newsreader text-headline-md text-on-surface">via {r.viaCity}</p>
                    <span
                      className="font-inter text-label-sm rounded-full px-sm py-xs flex items-center gap-xs"
                      style={{ background: fc.bg, color: fc.color }}
                    >
                      <span aria-hidden="true">{fc.icon}</span>
                      {fc.label}
                    </span>
                    {r.minRecommendedAge && (
                      <span className="font-inter text-label-sm text-outline">
                        Recommended age: {r.minRecommendedAge}+
                      </span>
                    )}
                  </div>
                  <p className="font-inter text-label-sm text-on-surface-variant">
                    {r.outboundCarrier} · Total: {r.totalDuration} · Layover: {r.layoverDuration}
                    {r.layoverAirportLounge && ' · Lounge access'}
                  </p>
                </div>

                {/* Price */}
                <div className="text-right">
                  <p className="font-newsreader text-headline-md text-primary">{gbp(r.familyTotal)}</p>
                  <p className="font-inter text-label-sm" style={{ color: '#3d6b33' }}>
                    Saves {gbp(r.saving)}
                  </p>
                </div>
              </div>

              {/* Friction note */}
              {r.frictionReason && (
                <div
                  className="rounded-sm px-md py-sm font-inter text-label-sm mb-md"
                  style={{ background: fc.bg, color: fc.color, borderLeft: `3px solid ${fc.color}` }}
                >
                  {r.frictionReason}
                </div>
              )}

              {/* Highlight */}
              {r.highlight && (
                <div
                  className="rounded-sm px-md py-sm font-inter text-label-sm"
                  style={{ background: '#f0fafb', borderLeft: '3px solid #0d8a9a', color: '#004349' }}
                >
                  {r.highlight}
                </div>
              )}

              {/* Savings bar */}
              <div className="mt-md pt-md border-t border-outline-variant">
                <div className="flex items-center justify-between font-inter text-label-sm text-on-surface-variant mb-xs">
                  <span>Saving vs direct</span>
                  <span className="font-semibold" style={{ color: '#3d6b33' }}>{gbp(r.saving)}</span>
                </div>
                <div className="h-2 rounded-full bg-surface-container-high">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, (r.saving / scaledDirectPrice) * 100)}%`,
                      background: r.kidAgeFriction === 'green' ? '#3d6b33' : r.kidAgeFriction === 'amber' ? '#fdba49' : '#ba1a1a',
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
