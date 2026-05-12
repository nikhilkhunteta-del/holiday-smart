'use client';

import { useState, useMemo } from 'react';

export interface BreakCalendarRevealProps {
  schoolName: string;
  borough: string;
  breakLabel: string;
  officialStart: string;
  officialEnd: string;
  insetDays: { date: string }[];
  dataSource: 'school' | 'borough';
  onTripStyleSelect?: (style: 'circuit' | 'base') => void;
}

// --- Date helpers (always local midnight, no UTC drift) ---

function parseLocal(str: string): Date {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

function toDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getMondayOfWeek(date: Date): Date {
  const dow = date.getDay(); // 0 = Sun
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

function getSundayOfWeek(date: Date): Date {
  const dow = date.getDay();
  return addDays(date, dow === 0 ? 0 : 7 - dow);
}

function daysBetweenInclusive(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

function walkBackThroughWeekends(date: Date): Date {
  let d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  for (;;) {
    const prev = addDays(d, -1);
    const dow = prev.getDay();
    if (dow === 0 || dow === 6) { d = prev; } else break;
  }
  return d;
}

function walkForwardThroughWeekends(date: Date): Date {
  let d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  for (;;) {
    const next = addDays(d, 1);
    const dow = next.getDay();
    if (dow === 0 || dow === 6) { d = next; } else break;
  }
  return d;
}

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_ABBR   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function fmtDay(str: string): string {
  const d = parseLocal(str);
  return `${DAY_ABBR[d.getDay()]} ${d.getDate()} ${MONTH_ABBR[d.getMonth()]}`;
}

// --- Types ---

type DayType = 'inset' | 'break' | 'weekend' | 'term';

interface CalendarCell {
  dateStr: string;
  dayNum: number;
  type: DayType;
}

type EmphasisLine =
  | { scenario: 'A'; insetDate: string; totalDays: number }
  | { scenario: 'B'; insetDate: string; totalDays: number }
  | { scenario: 'C'; insideDays: { date: string }[] }
  | { scenario: 'D' };

// --- Styles ---

const CELL_STYLES: Record<DayType, React.CSSProperties> = {
  inset:   { backgroundColor: '#fdba49', color: '#704b00' },
  break:   { backgroundColor: '#004349', color: '#ffffff' },
  weekend: { backgroundColor: '#e6e8e8', color: '#191c1d' },
  term:    { backgroundColor: '#ffffff',  color: '#6f797a' },
};

const LEGEND_ITEMS = [
  { color: '#004349', label: 'Official break', dot: 'filled' },
  { color: '#fdba49', label: 'Inset day',      dot: 'filled' },
  { color: '#e6e8e8', label: 'Weekend',         dot: 'filled' },
  { color: '#bfc8c9', label: 'Term time',       dot: 'outline' },
] as const;

const SCENARIO_PANEL_TEAL: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  background: '#f0fafb',
  borderLeft: '3px solid #0d8a9a',
  borderRadius: '0 4px 4px 0',
  padding: '10px 14px',
  marginBottom: 24,
  fontFamily: 'Inter, sans-serif',
  fontSize: 14,
  fontWeight: 500,
  color: '#004349',
  lineHeight: 1.4,
};

const SCENARIO_PANEL_AMBER: React.CSSProperties = {
  ...SCENARIO_PANEL_TEAL,
  background: '#fffbf0',
  borderLeft: '3px solid #fdba49',
  color: '#704b00',
};

// --- Component ---

export default function BreakCalendarReveal({
  schoolName: _schoolName,
  borough,
  breakLabel: _breakLabel,
  officialStart,
  officialEnd,
  insetDays,
  dataSource,
  onTripStyleSelect,
}: BreakCalendarRevealProps) {
  const [tripStyle, setTripStyle] = useState<'circuit' | 'base' | null>(null);

  const insetDaySet = useMemo(() => new Set(insetDays.map(d => d.date)), [insetDays]);

  // Build the flat list of calendar cells Mon → Sun across all weeks
  const calendarCells = useMemo((): CalendarCell[] => {
    const insetBefore = insetDays
      .filter(d => d.date < officialStart)
      .sort((a, b) => a.date.localeCompare(b.date));

    const earliestDate = insetBefore.length > 0
      ? parseLocal(insetBefore[0].date)
      : parseLocal(officialStart);

    const calStart = getMondayOfWeek(earliestDate);
    const calEnd   = getSundayOfWeek(parseLocal(officialEnd));

    const cells: CalendarCell[] = [];
    let cur = calStart;
    while (toDateStr(cur) <= toDateStr(calEnd)) {
      const dateStr = toDateStr(cur);
      const dow = cur.getDay();
      let type: DayType;

      if (insetDaySet.has(dateStr)) {
        type = 'inset';
      } else if (dateStr >= officialStart && dateStr <= officialEnd) {
        type = 'break';
      } else if (dow === 0 || dow === 6) {
        const prevStr = toDateStr(addDays(cur, -1));
        const nextStr = toDateStr(addDays(cur, 1));
        const touchesBreak =
          (prevStr >= officialStart && prevStr <= officialEnd) ||
          (nextStr >= officialStart && nextStr <= officialEnd);
        const touchesInset = insetDaySet.has(prevStr) || insetDaySet.has(nextStr);
        type = touchesBreak || touchesInset ? 'weekend' : 'term';
      } else {
        type = 'term';
      }

      cells.push({ dateStr, dayNum: cur.getDate(), type });
      cur = addDays(cur, 1);
    }
    return cells;
  }, [officialStart, officialEnd, insetDays, insetDaySet]);

  // Slice cells into rows of 7
  const weeks = useMemo(() => {
    const rows: CalendarCell[][] = [];
    for (let i = 0; i < calendarCells.length; i += 7) rows.push(calendarCells.slice(i, i + 7));
    return rows;
  }, [calendarCells]);

  // Determine emphasis line scenario
  const emphasis = useMemo((): EmphasisLine => {
    const before = insetDays.filter(d => d.date < officialStart).sort((a, b) => a.date.localeCompare(b.date));
    const after  = insetDays.filter(d => d.date > officialEnd).sort((a, b) => a.date.localeCompare(b.date));
    const inside = insetDays.filter(d => d.date >= officialStart && d.date <= officialEnd);

    if (before.length > 0) {
      const insetDate  = before[0].date;
      const fullStart  = walkBackThroughWeekends(parseLocal(insetDate));
      const fullEnd    = walkForwardThroughWeekends(parseLocal(officialEnd));
      return { scenario: 'A', insetDate, totalDays: daysBetweenInclusive(fullStart, fullEnd) };
    }
    if (after.length > 0) {
      const insetDate  = after[after.length - 1].date;
      const fullStart  = walkBackThroughWeekends(parseLocal(officialStart));
      const fullEnd    = walkForwardThroughWeekends(parseLocal(insetDate));
      return { scenario: 'B', insetDate, totalDays: daysBetweenInclusive(fullStart, fullEnd) };
    }
    if (inside.length > 0) {
      return { scenario: 'C', insideDays: inside };
    }
    return { scenario: 'D' };
  }, [insetDays, officialStart, officialEnd]);

  function handleTripStyle(style: 'circuit' | 'base') {
    setTripStyle(style);
    onTripStyleSelect?.(style);
  }

  return (
    <div style={{ marginTop: 24 }}>

      {/* Borough fallback notice */}
      {dataSource === 'borough' && (
        <p style={{
          fontFamily: 'Inter, sans-serif',
          fontSize: 12,
          fontWeight: 500,
          lineHeight: 1.4,
          color: '#3f484a',
          marginBottom: 12,
        }}>
          📍 Showing {borough} borough dates — confirm exact dates on your school website
        </p>
      )}

      {/* Calendar card */}
      <div style={{
        background: '#ffffff',
        borderRadius: '1rem',
        padding: 24,
        boxShadow: '0 8px 16px rgba(13,92,99,0.08)',
        marginBottom: 16,
      }}>

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
          {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day => (
            <div key={day} style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: '#3f484a',
              textAlign: 'center',
              padding: '4px 0',
            }}>
              {day}
            </div>
          ))}
        </div>

        {/* Week rows */}
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
            {week.map(cell => (
              <div
                key={cell.dateStr}
                style={{
                  ...CELL_STYLES[cell.type],
                  borderRadius: '0.5rem',
                  padding: '6px 2px',
                  textAlign: 'center',
                  fontFamily: 'Inter, sans-serif',
                  fontSize: 13,
                  fontWeight: cell.type === 'term' ? 400 : 500,
                  lineHeight: 1.2,
                  minHeight: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {cell.dayNum}
              </div>
            ))}
          </div>
        ))}

        {/* Legend */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px 20px',
          marginTop: 16,
          paddingTop: 16,
          borderTop: '1px solid #bfc8c9',
        }}>
          {LEGEND_ITEMS.map(item => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: item.dot === 'filled' ? item.color : 'transparent',
                border: item.dot === 'outline' ? `2px solid ${item.color}` : 'none',
                flexShrink: 0,
                display: 'inline-block',
              }} />
              <span style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: 12,
                fontWeight: 500,
                color: '#3f484a',
              }}>
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Emphasis line — Scenario A */}
      {emphasis.scenario === 'A' && (
        <div style={SCENARIO_PANEL_TEAL}>
          ⚡ {fmtDay(emphasis.insetDate)} is an inset day — leave the evening before and your window stretches to {emphasis.totalDays} days
        </div>
      )}

      {/* Emphasis line — Scenario B */}
      {emphasis.scenario === 'B' && (
        <div style={SCENARIO_PANEL_TEAL}>
          ⚡ {fmtDay(emphasis.insetDate)} is an inset day — return a day later and your window stretches to {emphasis.totalDays} days
        </div>
      )}

      {/* Emphasis line — Scenario C */}
      {emphasis.scenario === 'C' && (
        <div style={SCENARIO_PANEL_AMBER}>
          ℹ️ Your break includes {emphasis.insideDays.length} inset day{emphasis.insideDays.length > 1 ? 's' : ''} on {emphasis.insideDays.map(d => fmtDay(d.date)).join(', ')} — children are off the full period
        </div>
      )}

      {/* Trip style question */}
      <div>
        <p style={{
          fontFamily: 'Newsreader, serif',
          fontSize: 22,
          fontWeight: 500,
          lineHeight: 1.4,
          color: '#191c1d',
          marginBottom: 16,
        }}>
          How are you thinking about this trip?
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {([
            { key: 'circuit' as const, title: 'Circuit',  sub: 'Two or three cities, one trip' },
            { key: 'base'    as const, title: 'Base',     sub: 'One destination, done properly' },
          ]).map(opt => {
            const active = tripStyle === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => handleTripStyle(opt.key)}
                style={{
                  background: '#ffffff',
                  border: `2px solid ${active ? '#004349' : '#e6e8e8'}`,
                  borderRadius: '0.75rem',
                  padding: 16,
                  cursor: 'pointer',
                  textAlign: 'left',
                  boxShadow: active ? '0 0 0 1px #004349' : 'none',
                  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                }}
              >
                <div style={{
                  fontFamily: 'Inter, sans-serif',
                  fontSize: 14,
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                  color: active ? '#004349' : '#191c1d',
                  marginBottom: 4,
                }}>
                  {opt.title}
                </div>
                <div style={{
                  fontFamily: 'Inter, sans-serif',
                  fontSize: 13,
                  fontWeight: 400,
                  color: '#3f484a',
                  lineHeight: 1.4,
                }}>
                  {opt.sub}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
