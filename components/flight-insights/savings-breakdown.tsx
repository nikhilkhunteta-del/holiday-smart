'use client';

import { useState } from 'react';
import type { AssembledCombination, AssembledBaseline } from '@/lib/flights/assembleRecommendation';

interface Lever {
  label: string;
  winner: string;
  saving: number;
  above_threshold: boolean;
  is_borough_specific: boolean;
}

export interface SavingsData {
  baseline_price: number;
  smart_price: number;
  total_yield: number;
  net_yield: number;
  fine_gbp: number;
  fine_is_estimate: boolean;
  requires_absence: boolean;
  best_outbound_date: string;
  best_return_date: string;
  departure_absence_days: number;
  return_absence_days: number;
  levers: Lever[];
}

interface Props {
  data: SavingsData;
  adults: number;
  children: number;
  windowStart: string;
  recommendation: AssembledCombination | null;
  baseline: AssembledBaseline | null;
}

function fmt(n: number) {
  return '£' + Math.round(n).toLocaleString('en-GB');
}

function fmtDate(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const DAY_ABBR   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtShort(d: Date) {
  return `${DAY_ABBR[d.getDay()]} ${d.getDate()} ${MONTH_ABBR[d.getMonth()]}`;
}

export function SavingsBreakdown({ data, adults, children, windowStart, recommendation, baseline }: Props) {
  const [breakdownExpanded, setBreakdownExpanded] = useState(false);
  const hasAbsence = data.requires_absence;
  const heroSaving = hasAbsence ? data.net_yield : data.total_yield;
  const partySize  = adults + children;

  // Baseline departure: Saturday on or before windowStart
  const windowDate = new Date(windowStart + 'T00:00:00');
  const diff = (windowDate.getDay() + 1) % 7; // days since last Saturday
  const baselineDep = new Date(windowDate);
  baselineDep.setDate(windowDate.getDate() - diff);
  const baselineRet = new Date(baselineDep);
  baselineRet.setDate(baselineDep.getDate() + 4);
  const baselineDateRange = `${fmtShort(baselineDep)} → ${fmtShort(baselineRet)}`;

  const airportLever = data.levers?.find((l: any) => l.label?.startsWith('London airport'));
  const smartAirport = airportLever?.winner ?? 'LHR';

  return (
    <section
      className="bg-white rounded-lg p-lg"
      style={{ boxShadow: '0 8px 16px rgba(13,92,99,0.08)' }}
    >
      {/* Eyebrow */}
      <p className="font-inter text-label-sm uppercase tracking-widest text-primary mb-md">
        Savings breakdown
      </p>

      {/* ── Headline numbers ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-md mb-lg">

        {/* Baseline */}
        <div className="flex flex-col gap-xs">
          <span className="font-inter text-label-sm text-outline uppercase tracking-widest">
            Baseline
          </span>
          <span
            className="font-newsreader text-display-md text-on-surface-variant line-through decoration-outline"
            style={{ textDecorationColor: '#bfc8c9' }}
          >
            {fmt(data.baseline_price)}
          </span>
          <span className="font-inter text-label-sm text-outline">
            LHR · {baselineDateRange}
          </span>
          <span className="font-inter text-label-sm mt-2" style={{ color: '#6f797a', fontSize: 12 }}>
            Baseline is what most families pay — Saturday departure, Heathrow, no route optimisation.
          </span>
        </div>

        {/* Smart price */}
        <div className="flex flex-col gap-xs">
          <span className="font-inter text-label-sm text-primary uppercase tracking-widest">
            Smart price
          </span>
          <span className="font-newsreader text-display-md text-primary">
            {fmt(data.smart_price)}
          </span>
          <span className="font-inter text-label-sm text-on-surface-variant">
            {smartAirport} · {fmtDate(data.best_outbound_date)} → {fmtDate(data.best_return_date)}
          </span>
        </div>

        {/* Saving */}
        <div
          className="flex flex-col gap-xs rounded-md p-md"
          style={{ background: 'rgba(13,92,99,0.06)' }}
        >
          <span className="font-inter text-label-sm uppercase tracking-widest" style={{ color: '#004349' }}>
            {hasAbsence ? 'Net saving' : 'You save'}
          </span>
          <span className="font-newsreader text-display-lg" style={{ color: '#004349' }}>
            {fmt(heroSaving)}
          </span>
          {hasAbsence && (
            <span className="font-inter text-label-sm text-on-surface-variant">
              {fmt(data.total_yield)} gross · {fmt(data.fine_gbp)} fine
            </span>
          )}
        </div>
      </div>

      {/* ── Levers ─────────────────────────────────────────────────────────── */}
      <div className="border-t border-outline-variant pt-lg mb-lg">
        <p className="font-newsreader text-headline-md text-on-surface mb-md">
          How we got there
        </p>

        <div className="flex flex-col gap-sm">
          {data.levers.map((lever, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-sm px-md rounded-md"
              style={{
                background: lever.above_threshold ? 'rgba(253,186,73,0.08)' : '#f2f4f4',
                borderLeft: lever.above_threshold ? '3px solid #fdba49' : '3px solid transparent',
              }}
            >
              {/* Label + winner */}
              <div className="flex flex-col gap-xs min-w-0">
                {lever.label?.startsWith('London airport') ? (
                  <>
                    <span className="font-inter text-label-md text-on-surface">
                      We checked all 5 London airports
                    </span>
                    <span className="font-inter text-label-sm text-primary">
                      Flying from {lever.winner} saves £{Math.round(lever.saving)} net of your transport cost
                    </span>
                  </>
                ) : lever.label?.startsWith('Departure day') ? (
                  <>
                    <span className="font-inter text-label-md text-on-surface">
                      Flexible departure date saves £{Math.round(lever.saving)}
                    </span>
                    <span className="font-inter text-label-sm text-primary">
                      Flying {lever.winner} instead of the first day of the window
                    </span>
                  </>
                ) : lever.label?.startsWith('Open-jaw') ? (
                  <>
                    <span className="font-inter text-label-md text-on-surface">
                      Flying into a different airport saves £{Math.round(lever.saving)}
                    </span>
                    <span className="font-inter text-label-sm text-primary">
                      {lever.label}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-inter text-label-md text-on-surface truncate">
                      {lever.label}
                    </span>
                    <span className="font-inter text-label-sm text-primary">
                      → {lever.winner}
                    </span>
                  </>
                )}
              </div>

              {/* Saving + threshold badge */}
              <div className="flex items-center gap-sm flex-shrink-0 ml-md">
                <span className="font-inter text-label-md text-on-surface">
                  {fmt(lever.saving)}
                </span>
                {lever.above_threshold ? (
                  <span
                    className="font-inter text-label-sm rounded-full px-sm py-xs"
                    style={{ background: '#fdba49', color: '#704b00' }}
                  >
                    Saves
                  </span>
                ) : (
                  <span className="font-inter text-label-sm text-outline rounded-full px-sm py-xs border border-outline-variant">
                    Below threshold
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Fine context (conditional) ─────────────────────────────────────── */}
      {hasAbsence && (
        <div
          className="rounded-md px-md py-sm flex flex-col gap-xs"
          style={{ background: '#fffbf0', borderLeft: '3px solid #fdba49' }}
        >
          <p className="font-inter text-label-md text-on-surface">
            This option involves term-time absence
          </p>
          <div className="flex flex-wrap gap-md">
            {data.departure_absence_days > 0 && (
              <span className="font-inter text-label-sm text-on-surface-variant">
                {data.departure_absence_days} day{data.departure_absence_days !== 1 ? 's' : ''} early departure
              </span>
            )}
            {data.return_absence_days > 0 && (
              <span className="font-inter text-label-sm text-on-surface-variant">
                {data.return_absence_days} day{data.return_absence_days !== 1 ? 's' : ''} late return
              </span>
            )}
            <span className="font-inter text-label-sm text-on-surface-variant">
              Fine estimate: {fmt(data.fine_gbp)}{data.fine_is_estimate ? '*' : ''}
            </span>
          </div>
          {data.fine_is_estimate && (
            <p className="font-inter text-label-sm text-outline">
              * Fine amounts are estimates based on current borough penalty notice rates. Confirm with your school.
            </p>
          )}
          <p className="font-inter" style={{ fontSize: 12, color: '#6f797a' }}>
            Holiday Smart does not recommend taking children out of school during term time. This information is provided for transparency only.
          </p>
        </div>
      )}
      {/* ── Recommendation vs Baseline breakdown ──────────────────────────── */}
      {recommendation && baseline && (
        <div className="border-t border-outline-variant pt-lg mt-lg">

          {/* Headline saving */}
          <div className="flex flex-col gap-xs mb-md">
            <p className="font-inter text-label-sm uppercase tracking-widest text-primary">
              Total saving
            </p>
            <p className="font-newsreader text-display-lg" style={{ color: '#004349' }}>
              {fmt(baseline.total_cost_gbp - recommendation.total_cost_gbp)}
            </p>
            <p className="font-inter text-label-sm text-on-surface-variant">
              Smart trip vs. standard booking (LHR, Saturday, no optimisation)
            </p>
          </div>

          {/* Toggle */}
          <button
            onClick={() => setBreakdownExpanded(v => !v)}
            className="font-inter text-label-md rounded-md px-md py-sm flex items-center gap-sm mb-md"
            style={{ background: 'rgba(13,92,99,0.06)', color: '#004349', border: 'none', cursor: 'pointer' }}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>
              {breakdownExpanded ? '−' : '+'}
            </span>
            How we calculated your saving
          </button>

          {/* Expanded table */}
          {breakdownExpanded && (
            <div style={{ overflowX: 'auto' }}>
              <table
                className="w-full font-inter text-label-md"
                style={{ borderCollapse: 'collapse' }}
              >
                <thead>
                  <tr style={{ borderBottom: '1px solid #e2e8ea' }}>
                    <th className="text-left py-sm pr-lg text-on-surface-variant" style={{ fontWeight: 500 }}>
                      Component
                    </th>
                    <th className="text-right py-sm px-md text-primary" style={{ fontWeight: 600 }}>
                      Smart trip
                    </th>
                    <th className="text-right py-sm pl-md text-on-surface-variant" style={{ fontWeight: 500 }}>
                      Baseline
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      label: 'Flights',
                      smart: recommendation.outbound_fare_gbp + recommendation.return_fare_gbp,
                      base:  baseline.baseline_fare_gbp,
                    },
                    {
                      label: 'Cabin bags',
                      smart: recommendation.cabin_bag_cost_gbp,
                      base:  baseline.cabin_bag_cost_gbp,
                    },
                    {
                      label: 'Checked bags',
                      smart: recommendation.checked_bag_cost_gbp,
                      base:  baseline.checked_bag_cost_gbp,
                    },
                    {
                      label: 'Seats',
                      smart: recommendation.seat_cost_gbp,
                      base:  baseline.seat_cost_gbp,
                    },
                    {
                      label: 'Getting to airport',
                      smart: recommendation.transit_cost_gbp,
                      base:  baseline.transit_cost_gbp,
                    },
                    {
                      label: 'Airport transfers',
                      smart: recommendation.destination_transfer_cost_gbp,
                      base:  baseline.destination_transfer_cost_gbp,
                    },
                  ].map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f2f4f4' }}>
                      <td className="py-sm pr-lg text-on-surface-variant">{row.label}</td>
                      <td className="text-right py-sm px-md text-on-surface">{fmt(row.smart)}</td>
                      <td className="text-right py-sm pl-md" style={{ color: '#9ba8a9' }}>{fmt(row.base)}</td>
                    </tr>
                  ))}
                  {/* Total row */}
                  <tr style={{ borderTop: '2px solid #e2e8ea' }}>
                    <td className="py-sm pr-lg font-inter text-on-surface" style={{ fontWeight: 600 }}>
                      Total
                    </td>
                    <td className="text-right py-sm px-md font-inter text-primary" style={{ fontWeight: 700 }}>
                      {fmt(recommendation.total_cost_gbp)}
                    </td>
                    <td className="text-right py-sm pl-md font-inter" style={{ fontWeight: 600, color: '#9ba8a9' }}>
                      {fmt(baseline.total_cost_gbp)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
