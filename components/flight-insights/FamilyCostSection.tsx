'use client';

import { useState } from 'react';
import type { FareCostBreakdown } from '@/types/flight';

interface Props { fares: FareCostBreakdown[]; partySize: number }

function gbp(n: number) { return `£${n.toLocaleString('en-GB')}`; }

function scale(base4Value: number, partySize: number) {
  return Math.round(base4Value / 4 * partySize);
}

interface Totals {
  base: number; holdLuggage: number; seatSelection: number; speedyBoarding: number; allIn: number;
}

function totals(fare: FareCostBreakdown, partySize: number): Totals {
  const base           = fare.headlinePerPerson * partySize;
  const holdLuggage    = scale(fare.holdLuggage,    partySize);
  const seatSelection  = scale(fare.seatSelection,  partySize);
  const speedyBoarding = scale(fare.speedyBoarding, partySize);
  return { base, holdLuggage, seatSelection, speedyBoarding, allIn: base + holdLuggage + seatSelection + speedyBoarding };
}

interface BreakdownSegment { label: string; value: number; color: string }

function segments(t: Totals, partySize: number): BreakdownSegment[] {
  return [
    { label: `Base fares (×${partySize})`, value: t.base,           color: '#004349' },
    { label: 'Hold luggage',               value: t.holdLuggage,    color: '#0d5c63' },
    { label: 'Seat selection',             value: t.seatSelection,  color: '#fdba49' },
    { label: 'Speedy boarding',            value: t.speedyBoarding, color: '#fcb88a' },
  ].filter((s) => s.value > 0);
}

interface TooltipProps { fare: FareCostBreakdown; t: Totals; partySize: number; onClose: () => void }

function CostTooltip({ fare, t, partySize, onClose }: TooltipProps) {
  return (
    <div
      className="absolute z-50 left-0 mt-sm w-72 bg-surface-container-lowest rounded-lg shadow-lg border border-outline-variant p-md"
      style={{ boxShadow: '0 16px 32px rgba(13,92,99,0.12)' }}
    >
      <div className="flex items-center justify-between mb-md">
        <p className="font-inter text-label-md font-semibold text-on-surface">{fare.carrier} — breakdown</p>
        <button onClick={onClose} className="text-outline hover:text-on-surface transition-colors" aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div className="flex flex-col gap-xs font-inter text-body-md">
        {[
          { label: `Headline (${gbp(fare.headlinePerPerson)}/person)`, val: `× ${partySize} = ${gbp(t.base)}` },
          { label: 'Hold luggage',    val: t.holdLuggage    > 0 ? gbp(t.holdLuggage)    : 'Included' },
          { label: 'Seat selection',  val: t.seatSelection  > 0 ? gbp(t.seatSelection)  : 'Included' },
          { label: 'Speedy boarding', val: t.speedyBoarding > 0 ? gbp(t.speedyBoarding) : 'N/A'      },
        ].map(({ label, val }) => (
          <div key={label} className="flex items-center justify-between gap-md">
            <span className="text-on-surface-variant">{label}</span>
            <span className="font-medium text-on-surface whitespace-nowrap">{val}</span>
          </div>
        ))}
        <div className="h-px bg-outline-variant my-xs" />
        <div className="flex items-center justify-between font-semibold">
          <span className="text-on-surface">All-in total</span>
          <span className="text-primary">{gbp(t.allIn)}</span>
        </div>
      </div>
    </div>
  );
}

export function FamilyCostSection({ fares, partySize }: Props) {
  const [openTooltip, setOpenTooltip] = useState<string | null>(null);

  const computed = fares.map((f) => ({ fare: f, t: totals(f, partySize) }));
  const maxAllIn  = Math.max(...computed.map(({ t }) => t.allIn));
  const minAllIn  = Math.min(...computed.map(({ t }) => t.allIn));

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
          Headline fares hide the real cost. Every fare below shows the true all-in total for your party of {partySize}, with itemised extras.
        </p>
      </div>

      <div className="flex flex-col gap-md">
        {computed.map(({ fare, t }) => {
          const isOpen     = openTooltip === fare.carrier;
          const isCheapest = t.allIn === minAllIn;
          const barWidth   = (t.allIn / maxAllIn) * 100;
          const segs       = segments(t, partySize);

          return (
            <div key={fare.carrier} className="bg-surface-container-lowest border border-outline-variant rounded-lg p-lg shadow-sm">
              {/* Header */}
              <div className="flex items-start justify-between mb-md flex-wrap gap-sm">
                <div>
                  <div className="flex items-center gap-sm flex-wrap">
                    <p className="font-newsreader text-headline-md text-on-surface">{fare.carrier}</p>
                    {isCheapest && (
                      <span className="font-inter text-label-sm rounded-full px-sm py-xs" style={{ background: 'rgba(253,186,73,0.2)', color: '#704b00' }}>
                        ★ Cheapest all-in
                      </span>
                    )}
                    {fare.familySplitRisk && (
                      <span className="font-inter text-label-sm rounded-full px-sm py-xs flex items-center gap-xs" style={{ background: 'rgba(186,26,26,0.08)', color: '#ba1a1a' }}>
                        ⚠ Family split risk
                      </span>
                    )}
                  </div>
                  <p className="font-inter text-label-sm text-outline mt-xs">{fare.route}</p>
                </div>
                <div className="text-right">
                  <p className="font-inter text-label-sm text-outline mb-xs">Party of {partySize}</p>
                  <p className="font-newsreader text-headline-md text-primary">{gbp(t.allIn)}</p>
                  <p className="font-inter text-label-sm text-outline">all-in total</p>
                </div>
              </div>

              {/* Stacked bar */}
              <div className="h-3 rounded-full bg-surface-container-high overflow-hidden mb-sm">
                <div className="h-full rounded-full flex overflow-hidden" style={{ width: `${barWidth}%` }}>
                  {segs.map((seg) => (
                    <div
                      key={seg.label}
                      style={{ width: `${(seg.value / t.allIn) * 100}%`, background: seg.color }}
                      className="h-full"
                    />
                  ))}
                </div>
              </div>

              {/* Segment labels */}
              <div className="flex flex-wrap gap-md mb-md">
                {segs.map((seg) => (
                  <span key={seg.label} className="flex items-center gap-xs font-inter text-label-sm text-on-surface-variant">
                    <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: seg.color }} />
                    {seg.label}: <strong className="text-on-surface ml-xs">{gbp(seg.value)}</strong>
                  </span>
                ))}
              </div>

              {/* Footer row */}
              <div className="flex items-center justify-between flex-wrap gap-sm pt-md border-t border-outline-variant relative">
                <div className="flex items-center gap-sm flex-wrap font-inter text-body-md">
                  <span className="text-on-surface-variant">
                    Headline: <strong className="text-on-surface">{gbp(fare.headlinePerPerson)}/person</strong>
                  </span>
                  <span className="text-outline">·</span>
                  <span className="text-on-surface-variant">
                    True total: <strong className="text-primary">{gbp(t.allIn)}</strong>
                  </span>
                </div>
                <button
                  onClick={() => setOpenTooltip(isOpen ? null : fare.carrier)}
                  className="font-inter text-label-md text-primary underline underline-offset-2 hover:text-primary-container transition-colors"
                  aria-expanded={isOpen}
                >
                  {isOpen ? 'Hide breakdown' : 'Show full breakdown'}
                </button>
                {isOpen && <CostTooltip fare={fare} t={t} partySize={partySize} onClose={() => setOpenTooltip(null)} />}
              </div>

              {fare.familySplitRisk && (
                <div className="mt-md rounded-md px-md py-sm font-inter text-label-sm flex items-start gap-sm" style={{ background: 'rgba(186,26,26,0.06)', color: '#6b0004', border: '1px solid rgba(186,26,26,0.15)' }}>
                  <span className="flex-shrink-0">⚠</span>
                  <span>
                    <strong>{fare.carrier}</strong> uses algorithmic seating that can separate family members when seat selection is skipped. With a party of {partySize}, at least one seat pair is likely to be split across rows unless you pay for seat selection.
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-md mt-md pt-md border-t border-outline-variant">
        {[{ label: `Base fares (×${partySize})`, color: '#004349' }, { label: 'Hold luggage', color: '#0d5c63' }, { label: 'Seat selection', color: '#fdba49' }, { label: 'Speedy boarding', color: '#fcb88a' }].map(({ label, color }) => (
          <span key={label} className="flex items-center gap-xs font-inter text-label-sm text-on-surface-variant">
            <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
    </section>
  );
}
