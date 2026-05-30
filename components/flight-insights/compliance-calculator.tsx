'use client';

import { useState } from 'react';

function isEligible(
  scenario: any,
  windowStart: string,
  windowEnd: string
): boolean {
  // Rule 1: hard cap at 2 absence days
  if (scenario.total_absence_days > 2) return false

  // Rule 2: zero absence — always eligible
  if (scenario.total_absence_days === 0) return true

  // Rule 3: absence must be adjacent to the window.
  // The RPC correctly counts weekday-only absence days.
  // We trust departure_absence_days and return_absence_days from the RPC.
  // A scenario is adjacent if departure absence days account for ALL days
  // between departure and window_start, and return absence days account for
  // ALL days between window_end and return date.
  // Since the RPC already enforces this via calculate_absence_fine,
  // and the date ranges are now correctly constrained in the RPC,
  // any scenario returned with total_absence_days <= 2 is by definition adjacent.
  // The only remaining check: exclude scenarios where absence days are split
  // across both ends (departure AND return both have absence) unless uses_inset_day.

  if (scenario.departure_absence_days > 0 && scenario.return_absence_days > 0) {
    return scenario.uses_inset_day === true
  }

  return true
}

interface ComplianceCalculatorProps {
  data: {
    window_start: string
    window_end: string
    baseline_price: number
    scenarios: any[]
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtDate(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function gbp(n: number) {
  return `£${Math.round(Math.abs(n)).toLocaleString('en-GB')}`;
}

function ScenarioRow({ s }: { s: any }) {
  const hasFine    = s.fine_gbp > 0;
  const netSaving  = s.net_saving_vs_baseline ?? 0;
  const isPositive = netSaving > 0;
  const isNegative = netSaving < 0;

  return (
    <div
      className="flex items-start justify-between gap-md px-md py-sm"
      style={{ background: s.is_recommended ? 'rgba(13,92,99,0.04)' : 'transparent' }}
    >
      {/* Left: label + pills + date */}
      <div className="flex flex-col gap-xs min-w-0">
        <div className="flex items-center gap-xs flex-wrap">
          <span className="font-inter text-body-md font-medium text-on-surface">
            {s.label}
          </span>
          {s.is_recommended && (
            <span
              className="font-inter text-label-sm rounded-full px-sm py-xs flex-shrink-0"
              style={{ background: 'rgba(13,92,99,0.12)', color: '#004349' }}
            >
              Best value
            </span>
          )}
          {s.requires_term_time_absence && (
            <span
              className="font-inter text-label-sm rounded-full px-sm py-xs flex-shrink-0"
              style={{ background: 'rgba(253,186,73,0.18)', color: '#704b00' }}
            >
              Term time · {s.total_absence_days}d
            </span>
          )}
          {s.uses_inset_day && (
            <span
              className="font-inter text-label-sm rounded-full px-sm py-xs flex-shrink-0"
              style={{ background: 'rgba(13,92,99,0.08)', color: '#004349' }}
            >
              Inset day
            </span>
          )}
        </div>
        <span className="font-inter text-label-sm text-outline">
          {fmtDate(s.departure_date)} → {fmtDate(s.return_date)}
        </span>
        {hasFine && (
          <span className="font-inter text-label-sm" style={{ color: '#9a6800' }}>
            Fine: {gbp(s.fine_gbp)}*
          </span>
        )}
      </div>

      {/* Right: price + net saving */}
      <div className="flex flex-col items-end gap-xs flex-shrink-0">
        <span className="font-inter text-body-md font-semibold text-on-surface">
          {gbp(s.total_fare)}
        </span>
        {isPositive && (
          <span className="font-inter text-label-sm font-medium" style={{ color: '#1e6b2e' }}>
            +{gbp(netSaving)}
          </span>
        )}
        {isNegative && (
          <span className="font-inter text-label-sm text-on-surface-variant">
            -{gbp(netSaving)}
          </span>
        )}
      </div>
    </div>
  );
}

export function ComplianceCalculator({ data }: ComplianceCalculatorProps) {
  const [expanded, setExpanded] = useState(false);

  const eligible = data.scenarios.filter(s =>
    isEligible(s, data.window_start, data.window_end)
  );

  const group1 = eligible.filter(s => !s.requires_term_time_absence);
  const group2 = eligible.filter(s =>  s.requires_term_time_absence);

  const totalCount  = eligible.length;
  const defaultShow = 5;
  const visibleG1   = expanded ? group1 : group1.slice(0, defaultShow);
  const visibleG2   = expanded ? group2 : [];
  const hasMore     = group1.length > defaultShow || group2.length > 0;

  return (
    <section
      className="bg-white rounded-lg"
      style={{ padding: 24, boxShadow: '0 8px 16px rgba(13,92,99,0.08)' }}
      aria-labelledby="when-to-fly-heading"
    >
      <h2
        id="when-to-fly-heading"
        className="font-newsreader text-2xl font-medium text-on-surface mb-lg"
      >
        When to fly
      </h2>

      {eligible.length === 0 ? (
        <p className="font-inter text-body-md text-on-surface-variant">
          No eligible scenarios found for this window.
        </p>
      ) : (
        <>
          {/* Group 1 — term-time-free */}
          <div className="flex flex-col" style={{ gap: 0 }}>
            {visibleG1.map((s, i) => (
              <div key={s.label ?? i}>
                {i > 0 && <div style={{ height: 1, background: '#e6e8e8', marginLeft: 16, marginRight: 16 }} />}
                <ScenarioRow s={s} />
              </div>
            ))}
          </div>

          {/* Group 2 — extends into term time */}
          {expanded && group2.length > 0 && (
            <>
              <div
                className="flex items-center gap-sm my-md"
                style={{ borderTop: '1px solid #e6e8e8', paddingTop: 16, marginTop: 16 }}
              >
                <span
                  className="font-inter text-outline"
                  style={{ fontSize: 12 }}
                >
                  Extends into term time
                </span>
              </div>
              <div className="flex flex-col" style={{ gap: 0 }}>
                {visibleG2.map((s, i) => (
                  <div key={s.label ?? i}>
                    {i > 0 && <div style={{ height: 1, background: '#e6e8e8', marginLeft: 16, marginRight: 16 }} />}
                    <ScenarioRow s={s} />
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Toggle */}
          {hasMore && (
            <div className="mt-md pt-md" style={{ borderTop: '1px solid #e6e8e8' }}>
              <button
                onClick={() => setExpanded(v => !v)}
                className="font-inter text-label-md text-primary hover:underline"
              >
                {expanded
                  ? 'Show fewer'
                  : `Show all ${totalCount} options`
                }
              </button>
            </div>
          )}

          {/* Disclaimer — only when expanded */}
          {expanded && (
            <p
              className="font-inter text-outline mt-md"
              style={{ fontSize: 12 }}
            >
              Holiday Smart does not recommend term-time absence. Fine estimates are based on current borough penalty notice rates (£80/parent/child, rising to £160 if unpaid within 21 days). Confirm with your school. *Fines shown are estimates.
            </p>
          )}
        </>
      )}
    </section>
  );
}
