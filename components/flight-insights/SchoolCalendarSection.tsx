'use client';

import { useState } from 'react';
import type { SchoolCalendarData } from '@/types/flight';

interface Props { data: SchoolCalendarData }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmt(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000) + 1;
}

// Build a 2-week calendar grid centred on the break window
function buildCalendarDays(
  windowStart: string,
  windowEnd: string,
  officialStart: string,
  officialEnd: string,
  insetDates: string[],
) {
  const start = new Date(windowStart);
  // align to Monday of that week
  const dow = start.getDay();
  const gridStart = new Date(start);
  gridStart.setDate(gridStart.getDate() - ((dow === 0 ? 6 : dow - 1)));

  const end = new Date(windowEnd);
  const gridEndRaw = new Date(end);
  const dowEnd = gridEndRaw.getDay();
  if (dowEnd !== 0) gridEndRaw.setDate(gridEndRaw.getDate() + (7 - dowEnd));

  const days: { iso: string; day: number; label: string; type: 'weekend' | 'school' | 'official' | 'inset' | 'stretch' }[] = [];
  const cur = new Date(gridStart);
  while (cur <= gridEndRaw) {
    const iso = cur.toISOString().slice(0, 10);
    const isWeekend = cur.getDay() === 0 || cur.getDay() === 6;
    const isInset = insetDates.includes(iso);
    const isOfficial = iso >= officialStart && iso <= officialEnd;
    const isStretch = iso >= windowStart && iso <= windowEnd;

    let type: 'weekend' | 'school' | 'official' | 'inset' | 'stretch';
    if (isInset)         type = 'inset';
    else if (isOfficial) type = 'official';
    else if (isStretch)  type = 'stretch';
    else if (isWeekend)  type = 'weekend';
    else                 type = 'school';

    days.push({ iso, day: cur.getDate(), label: DAYS[cur.getDay()], type });
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

const typeStyles: Record<string, string> = {
  school:   'bg-surface-container-low text-on-surface-variant',
  weekend:  'bg-surface-container text-on-surface-variant',
  official: 'bg-primary text-on-primary font-semibold',
  inset:    'bg-secondary-container text-on-secondary-container font-semibold ring-2 ring-secondary-container',
  stretch:  'bg-primary/20 text-primary font-medium',
};

const typeLegend = [
  { type: 'official', label: 'Official break',   cls: 'bg-primary' },
  { type: 'inset',    label: 'Inset day',         cls: 'bg-secondary-container' },
  { type: 'stretch',  label: 'Stretch window',    cls: 'bg-primary/20 border border-primary/30' },
  { type: 'weekend',  label: 'Weekend',           cls: 'bg-surface-container border border-outline-variant' },
  { type: 'school',   label: 'Term time',         cls: 'bg-surface-container-low border border-outline-variant' },
];

export function SchoolCalendarSection({ data }: Props) {
  const [activeWindow, setActiveWindow] = useState(0);
  const selected = data.stretchWindows[activeWindow];

  const insetDates = data.insetDays.map((d) => d.date);
  const calDays = buildCalendarDays(
    selected.startDate,
    selected.endDate,
    data.officialStart,
    data.officialEnd,
    insetDates,
  );

  const weeks: typeof calDays[] = [];
  for (let i = 0; i < calDays.length; i += 7) weeks.push(calDays.slice(i, i + 7));

  return (
    <section aria-labelledby="calendar-heading">
      {/* Section header */}
      <div className="flex items-start justify-between mb-lg flex-wrap gap-md">
        <div>
          <span className="block font-inter text-label-sm uppercase tracking-widest text-primary-container mb-xs">
            School Calendar
          </span>
          <h2 id="calendar-heading" className="font-newsreader text-headline-lg text-on-surface">
            Your holiday window
          </h2>
        </div>

        {/* Comparison badge */}
        <div
          className="flex items-center gap-sm rounded-full px-md py-sm font-inter text-label-md"
          style={{ background: 'rgba(253,186,73,0.15)', color: '#704b00' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Your half-term starts {Math.abs(daysBetween(data.officialStart, data.londonAverageStartDate) - 1)} days earlier than {data.percentileEarlier}% of London schools
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-lg">
        {/* Left: inset alert + window picker */}
        <div className="flex flex-col gap-md">
          {/* Inset day alert */}
          {data.insetDays.length > 0 && (
            <div
              className="flex gap-sm rounded-sm p-md"
              style={{ background: '#f0fafb', borderLeft: '3px solid #0d8a9a' }}
            >
              <span className="text-sm flex-shrink-0 mt-px" aria-hidden="true">📅</span>
              <div className="font-inter text-label-sm text-primary">
                <strong className="font-semibold">Inset day detected</strong>
                {data.insetDays.map((d) => (
                  <p key={d.date} className="mt-xs font-normal">
                    {fmt(d.date)} — {d.label}. Leave the evening before and add a school day to your trip.
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Official break summary */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-lg p-lg shadow-sm">
            <p className="font-inter text-label-sm uppercase tracking-widest text-outline mb-md">Official break</p>
            <div className="flex items-baseline gap-sm mb-xs">
              <span className="font-newsreader text-headline-lg text-primary">{data.officialDays} days</span>
              <span className="font-inter text-body-md text-on-surface-variant">off school</span>
            </div>
            <p className="font-inter text-body-md text-on-surface-variant">
              {fmt(data.officialStart)} – {fmt(data.officialEnd)}
            </p>
            <div className="h-px bg-outline-variant my-md" />
            <p className="font-inter text-label-sm text-on-surface-variant">
              London average: {fmt(data.londonAverageStartDate)} – {fmt(data.londonAverageEndDate)}
            </p>
          </div>

          {/* Stretch windows */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-lg p-lg shadow-sm">
            <p className="font-inter text-label-sm uppercase tracking-widest text-outline mb-md">Eligible stretch windows</p>
            <div className="flex flex-col gap-sm">
              {data.stretchWindows.map((w, i) => (
                <button
                  key={w.label}
                  onClick={() => setActiveWindow(i)}
                  className={[
                    'text-left rounded-md px-md py-sm transition-all font-inter text-body-md border',
                    activeWindow === i
                      ? 'border-primary bg-primary/5 text-on-surface'
                      : 'border-outline-variant bg-transparent text-on-surface-variant hover:border-outline hover:bg-surface-container-low',
                  ].join(' ')}
                >
                  <span className="flex items-center justify-between">
                    <span className="font-semibold">{w.label}</span>
                    <span
                      className="font-inter text-label-sm rounded-full px-sm py-xs"
                      style={{ background: 'rgba(0,67,73,0.08)', color: '#004349' }}
                    >
                      {w.totalDays}d
                    </span>
                  </span>
                  <span className="text-label-sm text-outline mt-xs block">
                    {fmt(w.startDate)} – {fmt(w.endDate)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right: calendar grid */}
        <div className="lg:col-span-2 bg-surface-container-lowest border border-outline-variant rounded-lg p-lg shadow-sm">
          <div className="flex items-center justify-between mb-md">
            <p className="font-inter text-label-sm uppercase tracking-widest text-outline">
              {selected.label} — {selected.totalDays} days
            </p>
            <p className="font-inter text-label-sm text-on-surface-variant">
              {fmt(selected.startDate)} – {fmt(selected.endDate)}
            </p>
          </div>

          {/* Day labels */}
          <div className="grid grid-cols-7 gap-xs mb-xs">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="font-inter text-label-sm text-outline text-center py-xs">{d}</div>
            ))}
          </div>

          {/* Calendar cells */}
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-xs mb-xs">
              {week.map((day) => (
                <div
                  key={day.iso}
                  title={day.type === 'inset' ? 'Inset day' : day.type === 'official' ? 'Official break' : day.type === 'stretch' ? 'Stretch window' : undefined}
                  className={[
                    'rounded-md text-center py-sm font-inter text-label-sm leading-tight transition-all cursor-default',
                    typeStyles[day.type],
                  ].join(' ')}
                >
                  {day.day}
                </div>
              ))}
            </div>
          ))}

          {/* Legend */}
          <div className="flex flex-wrap gap-md mt-md pt-md border-t border-outline-variant">
            {typeLegend.map((l) => (
              <span key={l.type} className="flex items-center gap-xs font-inter text-label-sm text-on-surface-variant">
                <span className={`w-3 h-3 rounded-sm inline-block flex-shrink-0 ${l.cls}`} />
                {l.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
