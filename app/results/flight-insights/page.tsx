import { FlightInsightsClient } from './FlightInsightsClient';

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDateRange(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end   + 'T00:00:00');
  const sy = s.getFullYear(), ey = e.getFullYear();
  const sf = `${s.getDate()} ${MONTHS[s.getMonth()]}${sy !== ey ? ' ' + sy : ''}`;
  const ef = `${e.getDate()} ${MONTHS[e.getMonth()]} ${ey}`;
  return `${sf} – ${ef}`;
}

// ── Page (server component — reads searchParams) ───────────────────────────────

interface PageProps {
  searchParams: { school?: string; urn?: string; borough?: string; break?: string; start?: string; end?: string };
}

export default function FlightInsightsPage({ searchParams }: PageProps) {
  const start = searchParams.start ?? '';
  const end   = searchParams.end   ?? '';

  return (
    <FlightInsightsClient
      schoolContext={{
        school:     searchParams.school || searchParams.urn || 'Your school',
        borough:    searchParams.borough  || 'Your borough',
        breakLabel: searchParams.break    || 'Your break',
        dateRange:  start && end ? fmtDateRange(start, end) : '',
      }}
    />
  );
}
