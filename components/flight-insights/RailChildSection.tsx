import type { RailChildPolicy, Party } from '@/types/flight';

interface Props { policies: RailChildPolicy[]; party: Party }

function gbp(n: number) { return `£${n.toLocaleString('en-GB')}`; }

export function RailChildSection({ policies, party }: Props) {
  return (
    <section aria-labelledby="rail-child-heading">
      <div className="mb-lg">
        <span className="block font-inter text-label-sm uppercase tracking-widest text-primary-container mb-xs">
          Rail — Child Fares
        </span>
        <h2 id="rail-child-heading" className="font-newsreader text-headline-lg text-on-surface">
          Children travel free on these trains
        </h2>
        <p className="font-inter text-body-md text-on-surface-variant mt-sm max-w-xl">
          Several European operators offer free or deeply discounted child fares that most parents don&apos;t know about at booking. These savings can fund an extra night.
        </p>
      </div>

      <div className="flex flex-col gap-md">
        {policies.map((p) => {
          const eligibleChildren = party.childAges.filter((age) => age <= p.maxChildAge).length;
          const cappedPerAdult   = Math.min(eligibleChildren, p.maxChildrenPerAdult * party.adults);
          const familySaving     = cappedPerAdult * p.savingPerChild;
          return (
          <div
            key={p.id}
            className="bg-surface-container-lowest border border-outline-variant rounded-lg p-lg shadow-sm"
          >
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-lg">
              {/* Operator + policy */}
              <div className="lg:col-span-2 flex flex-col gap-md">
                <div className="flex items-center gap-sm flex-wrap">
                  <div
                    className="px-md py-xs rounded-md font-inter text-label-md font-semibold"
                    style={{ background: 'rgba(0,67,73,0.08)', color: '#004349' }}
                  >
                    {p.operator}
                  </div>
                  {p.countries.map((c) => (
                    <span
                      key={c}
                      className="font-inter text-label-sm rounded-full px-sm py-xs"
                      style={{ background: 'rgba(95,141,84,0.1)', color: '#3d6b33' }}
                    >
                      {c}
                    </span>
                  ))}
                </div>

                <p className="font-inter text-body-md text-on-surface">{p.policy}</p>

                <div className="flex flex-wrap gap-md font-inter text-label-sm text-on-surface-variant">
                  <span>Up to age {p.maxChildAge}</span>
                  <span>·</span>
                  <span>Max {p.maxChildrenPerAdult} children/adult</span>
                  {p.requiresRegistration && (
                    <>
                      <span>·</span>
                      <span
                        className="rounded-full px-sm py-xs"
                        style={{ background: 'rgba(253,186,73,0.15)', color: '#704b00' }}
                      >
                        ⚠ Must register at booking
                      </span>
                    </>
                  )}
                </div>

                <div
                  className="rounded-sm px-md py-sm font-inter text-label-sm flex items-start gap-sm"
                  style={{ background: '#f0fafb', borderLeft: '3px solid #0d8a9a', color: '#004349' }}
                >
                  <span aria-hidden="true">ℹ</span>
                  <span>{p.bookingNote}</span>
                </div>

                <p className="font-inter text-label-sm text-on-surface-variant">
                  Example route: <strong className="text-on-surface">{p.route}</strong>
                </p>
              </div>

              {/* Savings panel */}
              <div className="bg-surface-container-low rounded-lg p-md flex flex-col gap-md justify-between border border-outline-variant">
                <p className="font-inter text-label-sm uppercase tracking-wider text-outline">Your family saves</p>
                <div>
                  {familySaving > 0 ? (
                    <>
                      <p className="font-newsreader text-headline-lg text-primary">{gbp(familySaving)}</p>
                      <p className="font-inter text-label-sm text-on-surface-variant mt-xs">
                        {cappedPerAdult} qualifying {cappedPerAdult === 1 ? 'child' : 'children'}
                      </p>
                    </>
                  ) : (
                    <p className="font-inter text-body-md text-on-surface-variant">No qualifying children for this policy</p>
                  )}
                </div>
                <div className="h-px bg-outline-variant" />
                <div className="flex flex-col gap-xs font-inter text-label-sm">
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Adult fare</span>
                    <span className="font-medium text-on-surface">{gbp(p.adultFare)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Saving per child</span>
                    <span className="font-medium" style={{ color: '#3d6b33' }}>{gbp(p.savingPerChild)}</span>
                  </div>
                  <div className="flex justify-between font-semibold border-t border-outline-variant pt-xs mt-xs">
                    <span className="text-on-surface">Total saved</span>
                    <span style={{ color: familySaving > 0 ? '#3d6b33' : '#6f797a' }}>{familySaving > 0 ? gbp(familySaving) : '—'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          );
        })}
      </div>
    </section>
  );
}
