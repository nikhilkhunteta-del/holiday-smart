'use client';

import { useState } from 'react';

export interface ComplianceScenario {
  label: string;
  departure_date: string;
  return_date: string;
  outbound_fare: number;
  return_fare: number;
  total_fare: number;
  trip_days: number;
  total_absence_days: number;
  departure_absence_days: number;
  return_absence_days: number;
  requires_term_time_absence: boolean;
  uses_inset_day: boolean;
  fine_gbp: number;
  fine_is_estimate: boolean;
  gross_saving: number;
  net_saving_vs_baseline: number;
  is_recommended: boolean;
}

interface ComplianceCalculatorProps {
  data: {
    window_start: string;
    window_end: string;
    baseline_price: number;
    scenarios: ComplianceScenario[];
  };
}

const INITIAL_SHOW = 7;

function ScenarioRow({ scenario }: { scenario: ComplianceScenario }) {
  const saving = scenario.net_saving_vs_baseline;
  const isPositiveSaving = saving > 0;

  return (
    <div
      className="flex flex-wrap items-start gap-y-sm py-sm px-md border-b"
      style={{
        borderColor: '#e6e8e8',
        background: scenario.is_recommended ? 'rgba(13,92,99,0.04)' : 'transparent',
      }}
    >
      {/* Date range + badges row */}
      <div className="flex flex-col gap-xs flex-1 min-w-0 pr-md">
        <div className="flex flex-wrap items-center gap-xs">
          <span className="font-inter text-label-md text-on-surface">
            {scenario.label}
          </span>
          {scenario.is_recommended && (
            <span
              className="font-inter text-label-sm rounded-full px-sm py-xs"
              style={{ background: '#004349', color: '#ffffff', fontSize: 11 }}
            >
              Best value
            </span>
          )}
          {scenario.uses_inset_day && (
            <span
              className="font-inter text-label-sm rounded-full px-sm py-xs"
              style={{ background: 'rgba(13,92,99,0.12)', color: '#004349', fontSize: 11 }}
            >
              Inset day
            </span>
          )}
          {scenario.requires_term_time_absence && (
            <span
              className="font-inter text-label-sm rounded-full px-sm py-xs"
              style={{ background: '#fdba49', color: '#704b00', fontSize: 11 }}
            >
              Term time · {scenario.total_absence_days}d
            </span>
          )}
        </div>
        {scenario.fine_gbp > 0 && (
          <span className="font-inter text-label-sm" style={{ color: '#805600' }}>
            Fine: £{scenario.fine_gbp.toLocaleString('en-GB')}
            {scenario.fine_is_estimate ? '*' : ''}
          </span>
        )}
      </div>

      {/* Fare + saving */}
      <div className="flex flex-col items-end gap-xs flex-shrink-0">
        <span className="font-inter text-label-md text-on-surface">
          £{scenario.total_fare.toLocaleString('en-GB')}
        </span>
        {saving !== 0 && (
          <span
            className="font-inter text-label-sm"
            style={{ color: isPositiveSaving ? '#004349' : '#6f797a' }}
          >
            {isPositiveSaving
              ? `£${saving.toLocaleString('en-GB')} saving`
              : `£${Math.abs(saving).toLocaleString('en-GB')} more`}
          </span>
        )}
      </div>
    </div>
  );
}

export function ComplianceCalculator({ data }: ComplianceCalculatorProps) {
  const [expanded, setExpanded] = useState(false);

  const withinWindow = data.scenarios.filter(s => !s.requires_term_time_absence);
  const termTime     = data.scenarios.filter(s => s.requires_term_time_absence);
  const total        = data.scenarios.length;
  const hasMore      = total > INITIAL_SHOW;

  // Distribute the initial 7 slots: fill within-window first, then term-time
  const visibleWithin   = expanded ? withinWindow : withinWindow.slice(0, INITIAL_SHOW);
  const remainingSlots  = Math.max(0, INITIAL_SHOW - visibleWithin.length);
  const visibleTermTime = expanded ? termTime : termTime.slice(0, remainingSlots);

  const showTermTimeSection = expanded ? termTime.length > 0 : visibleTermTime.length > 0;

  return (
    <section
      className="bg-white rounded-lg"
      style={{ boxShadow: '0 8px 16px rgba(13,92,99,0.08)', padding: 24 }}
    >
      <h2 className="font-newsreader text-headline-lg text-on-surface mb-lg">
        When to fly
      </h2>

      {/* Within official window group */}
      {visibleWithin.length > 0 && (
        <div className="mb-md">
          <div
            className="border-t"
            style={{ borderColor: '#e6e8e8' }}
          >
            {visibleWithin.map((s, i) => (
              <ScenarioRow key={`within-${i}`} scenario={s} />
            ))}
          </div>
        </div>
      )}

      {/* Term-time group */}
      {showTermTimeSection && (
        <div className="mt-md">
          <div className="flex items-center gap-md mb-sm">
            <div className="flex-1 h-px" style={{ background: '#e6e8e8' }} />
            <span
              className="font-inter text-label-sm flex-shrink-0"
              style={{ color: '#6f797a', fontSize: 12 }}
            >
              Extends into term time
            </span>
            <div className="flex-1 h-px" style={{ background: '#e6e8e8' }} />
          </div>

          <div className="border-t" style={{ borderColor: '#e6e8e8' }}>
            {visibleTermTime.map((s, i) => (
              <ScenarioRow key={`term-${i}`} scenario={s} />
            ))}
          </div>

          <p
            className="font-inter mt-sm"
            style={{ fontSize: 11, color: '#6f797a', lineHeight: 1.5 }}
          >
            Holiday Smart does not recommend term-time absence. Fines shown are estimates based on
            current borough penalty notice rates.
          </p>
        </div>
      )}

      {/* Expand toggle */}
      {hasMore && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-md font-inter text-label-sm"
          style={{ color: '#004349', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          {expanded ? 'Show fewer options' : `Show all ${total} options`}
        </button>
      )}
    </section>
  );
}
