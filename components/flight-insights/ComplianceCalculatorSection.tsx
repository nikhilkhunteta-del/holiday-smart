'use client';

import { useState } from 'react';
import type { ComplianceScenario, Party } from '@/types/flight';

interface Props {
  scenarios: ComplianceScenario[];
  borough: string;
  party: Party;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmt(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
function fmtDay(iso: string) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[new Date(iso).getDay()];
}
function gbp(n: number) {
  return n === 0 ? '£0' : `£${n.toLocaleString('en-GB')}`;
}

// Fine = £80 per parent, per child (UK statutory scheme)
function computedFine(finePerParent: number, adults: number, children: number) {
  return finePerParent * adults * children;
}

type Tab = 'table' | 'detail';

export function ComplianceCalculatorSection({ scenarios, borough, party }: Props) {
  const [activeIdx, setActiveIdx] = useState(1);
  const [tab, setTab] = useState<Tab>('table');

  // Re-derive totals from actual party composition
  const derived = scenarios.map((s) => {
    const totalFine = computedFine(s.finePerParent, party.adults, party.children);
    const netSaving = s.grossSaving - totalFine;
    return { ...s, totalFine, netSaving, parents: party.adults, children: party.children };
  });

  const active = derived[activeIdx];
  const bestNetSaving = Math.max(...derived.map((s) => s.netSaving));
  const bestIdx = derived.findIndex((s) => s.netSaving === bestNetSaving);

  return (
    <section aria-labelledby="compliance-heading">
      <div className="flex items-start justify-between mb-lg flex-wrap gap-md">
        <div>
          <span className="block font-inter text-label-sm uppercase tracking-widest text-primary-container mb-xs">
            Compliance Calculus
          </span>
          <h2 id="compliance-heading" className="font-newsreader text-headline-lg text-on-surface">
            Fine vs fare: the honest maths
          </h2>
        </div>
      </div>

      {/* Legal disclaimer */}
      <div
        className="flex gap-sm rounded-md p-md mb-lg font-inter text-label-sm"
        style={{ background: 'rgba(186,26,26,0.06)', border: '1px solid rgba(186,26,26,0.2)', color: '#6b0004' }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-px" aria-hidden="true">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span>
          <strong>Legal disclaimer:</strong> Taking children out of school during term time without authorisation may result in a fixed-penalty notice. Fine amounts shown are based on current {borough} council rates (£80/parent per child for up to 5 days, rising to £160 if unpaid within 21 days). Shown for {party.adults} adult{party.adults !== 1 ? 's' : ''}, {party.children} child{party.children !== 1 ? 'ren' : ''}. Holiday Smart does not endorse term-time absence. This tool is for information only.
        </span>
      </div>

      {/* Tab bar */}
      <div className="flex gap-sm mb-lg border-b border-outline-variant">
        {(['table', 'detail'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              'font-inter text-label-md pb-sm px-xs transition-colors border-b-2 -mb-px',
              tab === t
                ? 'text-primary border-primary'
                : 'text-on-surface-variant border-transparent hover:text-on-surface',
            ].join(' ')}
          >
            {t === 'table' ? 'Comparison table' : 'Scenario detail'}
          </button>
        ))}
      </div>

      {tab === 'table' ? (
        <div className="overflow-x-auto rounded-lg border border-outline-variant shadow-sm">
          <table className="w-full border-collapse font-inter text-body-md">
            <thead>
              <tr className="bg-surface-container-low border-b border-outline-variant">
                <th className="text-left px-lg py-md font-semibold text-label-md uppercase tracking-wider text-outline">Scenario</th>
                <th className="text-right px-lg py-md font-semibold text-label-md uppercase tracking-wider text-outline">Depart</th>
                <th className="text-right px-lg py-md font-semibold text-label-md uppercase tracking-wider text-outline">Flight cost</th>
                <th className="text-right px-lg py-md font-semibold text-label-md uppercase tracking-wider text-outline">
                  Fine ({party.adults}A × {party.children}C)
                </th>
                <th className="text-right px-lg py-md font-semibold text-label-md uppercase tracking-wider text-outline">Net saving</th>
              </tr>
            </thead>
            <tbody>
              {derived.map((s, i) => {
                const isBest     = i === bestIdx && s.netSaving > 0;
                const isSelected = i === activeIdx;
                return (
                  <tr
                    key={s.label}
                    onClick={() => { setActiveIdx(i); setTab('detail'); }}
                    className={[
                      'border-b border-outline-variant cursor-pointer transition-colors last:border-0',
                      isSelected ? 'bg-primary/5' : 'hover:bg-surface-container-low',
                    ].join(' ')}
                  >
                    <td className="px-lg py-md">
                      <span className="flex items-center gap-sm flex-wrap">
                        <span className="font-medium text-on-surface">{s.label}</span>
                        {isBest && (
                          <span className="font-inter text-label-sm rounded-full px-sm py-xs" style={{ background: 'rgba(253,186,73,0.2)', color: '#704b00' }}>Best value</span>
                        )}
                        {s.daysEarly === 0 && (
                          <span className="font-inter text-label-sm rounded-full px-sm py-xs bg-surface-container text-on-surface-variant">Baseline</span>
                        )}
                      </span>
                    </td>
                    <td className="px-lg py-md text-right text-on-surface-variant">
                      {fmtDay(s.departureDate)} {fmt(s.departureDate)}
                    </td>
                    <td className="px-lg py-md text-right font-semibold text-on-surface">{gbp(s.flightCost)}</td>
                    <td className="px-lg py-md text-right">
                      {s.totalFine === 0
                        ? <span className="text-on-surface-variant">—</span>
                        : <span style={{ color: '#ba1a1a' }}>{gbp(s.totalFine)}</span>
                      }
                    </td>
                    <td className="px-lg py-md text-right font-semibold">
                      {s.netSaving === 0
                        ? <span className="text-on-surface-variant">—</span>
                        : s.netSaving > 0
                          ? <span style={{ color: '#3d6b33' }}>+{gbp(s.netSaving)}</span>
                          : <span style={{ color: '#ba1a1a' }}>{gbp(s.netSaving)}</span>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg">
          <div className="flex flex-col gap-sm">
            {derived.map((s, i) => (
              <button
                key={s.label}
                onClick={() => setActiveIdx(i)}
                className={[
                  'text-left rounded-md px-md py-sm transition-all border font-inter text-body-md',
                  activeIdx === i
                    ? 'border-primary bg-primary/5 text-on-surface'
                    : 'border-outline-variant text-on-surface-variant hover:border-outline hover:bg-surface-container-low',
                ].join(' ')}
              >
                <span className="font-semibold">{s.label}</span>
                {s.daysEarly > 0 && (
                  <span className="block text-label-sm text-outline mt-xs">
                    Depart {fmtDay(s.departureDate)} {fmt(s.departureDate)}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="bg-surface-container-lowest border border-outline-variant rounded-lg p-lg shadow-sm flex flex-col gap-md">
            <div className="flex items-start justify-between flex-wrap gap-sm">
              <div>
                <p className="font-inter text-label-sm uppercase tracking-widest text-outline mb-xs">Selected scenario</p>
                <p className="font-newsreader text-headline-md text-on-surface">{active.label}</p>
              </div>
              {activeIdx === bestIdx && active.netSaving > 0 && (
                <span className="font-inter text-label-sm rounded-full px-md py-xs" style={{ background: 'rgba(253,186,73,0.2)', color: '#704b00' }}>
                  ★ Best net saving
                </span>
              )}
            </div>

            <div className="h-px bg-outline-variant" />

            <div className="grid grid-cols-2 gap-md">
              {[
                { label: 'Departure',              val: `${fmtDay(active.departureDate)} ${fmt(active.departureDate)}`, highlight: false },
                { label: 'Return',                 val: fmt(active.returnDate),                                         highlight: false },
                { label: 'Flight cost',            val: gbp(active.flightCost),                                         highlight: false },
                { label: 'Flight saving',          val: active.grossSaving > 0 ? gbp(active.grossSaving) : '—',         highlight: true  },
                { label: `Fine (£80 × ${party.adults}A × ${party.children}C)`, val: active.totalFine > 0 ? gbp(active.totalFine) : '—', highlight: false },
                { label: 'Net saving',             val: active.netSaving > 0 ? gbp(active.netSaving) : active.netSaving < 0 ? gbp(active.netSaving) : '—', highlight: active.netSaving > 0 },
              ].map(({ label, val, highlight }) => (
                <div key={label}>
                  <p className="font-inter text-label-sm uppercase tracking-wider text-outline mb-xs">{label}</p>
                  <p className={['font-inter text-body-lg font-semibold', highlight ? 'text-primary' : 'text-on-surface'].join(' ')}>
                    {val}
                  </p>
                </div>
              ))}
            </div>

            {active.daysEarly > 0 && (
              <>
                <div className="h-px bg-outline-variant" />
                <p className="font-inter text-body-md text-on-surface-variant">
                  Leaving <strong className="text-on-surface">{fmtDay(active.departureDate)} {fmt(active.departureDate)}</strong> ({active.daysEarly} school {active.daysEarly === 1 ? 'day' : 'days'} early) saves{' '}
                  <strong className="text-on-surface">{gbp(active.grossSaving)}</strong> on flights.
                  {active.totalFine > 0 && <> Fine exposure: <span style={{ color: '#ba1a1a' }}>{gbp(active.totalFine)}</span>.</>}
                  {active.netSaving > 0 && <strong className="text-primary"> Net saving: {gbp(active.netSaving)}.</strong>}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
