'use client';

import { useState } from 'react';
import type { FareCostBreakdown } from '@/types/flight';

interface Props { fares: FareCostBreakdown[] }

function gbp(n: number) { return `£${n.toLocaleString('en-GB')}`; }

const costItems: { key: keyof FareCostBreakdown; label: string; color: string }[] = [
  { key: 'baseFamilyTotal', label: 'Base fares (×4)',    color: '#004349' },
  { key: 'holdLuggage',     label: 'Hold luggage',       color: '#0d5c63' },
  { key: 'seatSelection',   label: 'Seat selection',     color: '#fdba49' },
  { key: 'speedyBoarding',  label: 'Speedy boarding',    color: '#fcb88a' },
];

interface TooltipProps { fare: FareCostBreakdown; onClose: () => void }

function CostTooltip({ fare, onClose }: TooltipProps) {
  return (
    <div
      className="absolute z-50 left-0 mt-sm w-72 bg-surface-container-lowest rounded-lg shadow-lg border border-outline-variant p-md"
      style={{ boxShadow: '0 16px 32px rgba(13,92,99,0.12)' }}
    >
      <div className="flex items-center justify-between mb-md">
        <p className="font-inter text-label-md font-semibold text-on-surface">{fare.carrier} — full breakdown</p>
        <button onClick={onClose} className="text-outline hover:text-on-surface transition-colors" aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div className="flex flex-col gap-xs font-inter text-body-md">
        {[
          { label: 'Headline per person', val: gbp(fare.headlinePerPerson) },
          { label: 'Base (×4 people)', val: gbp(fare.baseFamilyTotal) },
          { label: 'Hold luggage', val: fare.holdLuggage > 0 ? gbp(fare.holdLuggage) : 'Included' },
          { label: 'Seat selection', val: fare.seatSelection > 0 ? gbp(fare.seatSelection) : 'Included' },
          { label: 'Speedy boarding', val: fare.speedyBoarding > 0 ? gbp(fare.speedyBoarding) : 'N/A' },
        ].map(({ label, val }) => (
          <div key={label} className="flex items-center justify-between">
            <span className="text-on-surface-variant">{label}</span>
            <span className="font-medium text-on-surface">{val}</span>
          </div>
        ))}
        <div className="h-px bg-outline-variant my-xs" />
        <div className="flex items-center justify-between font-semibold">
          <span className="text-on-surface">All-in family total</span>
          <span className="text-primary">{gbp(fare.allInTotal)}</span>
        </div>
      </div>
    </div>
  );
}

export function FamilyCostSection({ fares }: Props) {
  const [openTooltip, setOpenTooltip] = useState<string | null>(null);
  const maxTotal = Math.max(...fares.map((f) => f.allInTotal));
  const cheapest = Math.min(...fares.map((f) => f.allInTotal));

  return (
    <section aria-labelledby="family-cost-heading">
      <div className="mb-lg">
        <span className="block font-inter text-label-sm uppercase tracking-widest text-primary-container mb-xs">
          All-in Cost
        </span>
        <h2 id="family-cost-heading" className="font-newsreader text-headline-lg text-on-surface">
          What the airline doesn&apos;t tell you
        </h2>
        <p className="font-inter text-body-md text-on-surface-variant mt-sm max-w-xl">
          Headline fares hide the real family cost. Every fare below shows the true all-in total for a family of 4, with itemised extras.
        </p>
      </div>

      <div className="flex flex-col gap-md">
        {fares.map((fare) => {
          const isOpen    = openTooltip === fare.carrier;
          const isCheapest = fare.allInTotal === cheapest;
          const barWidth  = (fare.allInTotal / maxTotal) * 100;

          return (
            <div
              key={fare.carrier}
              className="bg-surface-container-lowest border border-outline-variant rounded-lg p-lg shadow-sm"
            >
              {/* Header row */}
              <div className="flex items-start justify-between mb-md flex-wrap gap-sm">
                <div>
                  <div className="flex items-center gap-sm flex-wrap">
                    <p className="font-newsreader text-headline-md text-on-surface">{fare.carrier}</p>
                    {isCheapest && (
                      <span
                        className="font-inter text-label-sm rounded-full px-sm py-xs"
                        style={{ background: 'rgba(253,186,73,0.2)', color: '#704b00' }}
                      >
                        ★ Cheapest all-in
                      </span>
                    )}
                    {fare.familySplitRisk && (
                      <span
                        className="font-inter text-label-sm rounded-full px-sm py-xs flex items-center gap-xs"
                        style={{ background: 'rgba(186,26,26,0.08)', color: '#ba1a1a' }}
                      >
                        ⚠ Family split risk
                      </span>
                    )}
                  </div>
                  <p className="font-inter text-label-sm text-outline mt-xs">{fare.route}</p>
                </div>
                <div className="text-right">
                  <p className="font-inter text-label-sm text-outline mb-xs">From</p>
                  <p className="font-newsreader text-headline-md text-primary">{gbp(fare.allInTotal)}</p>
                  <p className="font-inter text-label-sm text-outline">family total</p>
                </div>
              </div>

              {/* Stacked bar */}
              <div className="relative mb-sm">
                <div className="h-3 rounded-full bg-surface-container-high overflow-hidden">
                  <div
                    className="h-full rounded-full flex overflow-hidden"
                    style={{ width: `${barWidth}%` }}
                  >
                    {costItems.map(({ key, color }) => {
                      const val = fare[key] as number;
                      if (!val) return null;
                      const segW = (val / fare.allInTotal) * 100;
                      return (
                        <div
                          key={key}
                          style={{ width: `${segW}%`, background: color }}
                          className="h-full"
                        />
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Cost items row */}
              <div className="flex flex-wrap gap-md mb-md">
                {costItems.map(({ key, label, color }) => {
                  const val = fare[key] as number;
                  if (!val) return null;
                  return (
                    <span key={key} className="flex items-center gap-xs font-inter text-label-sm text-on-surface-variant">
                      <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: color }} />
                      {label}: <strong className="text-on-surface ml-xs">{gbp(val)}</strong>
                    </span>
                  );
                })}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between flex-wrap gap-sm pt-md border-t border-outline-variant relative">
                <div className="flex items-center gap-sm flex-wrap">
                  <span className="font-inter text-body-md text-on-surface-variant">
                    Headline: <strong className="text-on-surface">{gbp(fare.headlinePerPerson)}/person</strong>
                  </span>
                  <span className="text-outline">·</span>
                  <span className="font-inter text-body-md text-on-surface-variant">
                    True total: <strong className="text-primary">{gbp(fare.allInTotal)}</strong>
                  </span>
                </div>
                <button
                  onClick={() => setOpenTooltip(isOpen ? null : fare.carrier)}
                  className="font-inter text-label-md text-primary underline underline-offset-2 hover:text-primary-container transition-colors"
                  aria-expanded={isOpen}
                >
                  {isOpen ? 'Hide breakdown' : 'Show full breakdown'}
                </button>
                {isOpen && <CostTooltip fare={fare} onClose={() => setOpenTooltip(null)} />}
              </div>

              {/* Family split warning */}
              {fare.familySplitRisk && (
                <div
                  className="mt-md rounded-md px-md py-sm font-inter text-label-sm flex items-start gap-sm"
                  style={{ background: 'rgba(186,26,26,0.06)', color: '#6b0004', border: '1px solid rgba(186,26,26,0.15)' }}
                >
                  <span className="flex-shrink-0">⚠</span>
                  <span>
                    <strong>{fare.carrier}</strong> uses algorithmic seating that can separate family members when seat selection is skipped. With a party of 4, at least one seat pair is likely to be split across rows unless you pay for seat selection.
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-md mt-md pt-md border-t border-outline-variant">
        {costItems.map(({ label, color }) => (
          <span key={label} className="flex items-center gap-xs font-inter text-label-sm text-on-surface-variant">
            <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
    </section>
  );
}
