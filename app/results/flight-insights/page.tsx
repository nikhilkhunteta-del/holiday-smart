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
  searchParams: {
    school?: string;
    urn?: string;
    borough?: string;
    break?: string;
    start?: string;
    end?: string;
    adults?: string;
    children?: string;
    childAges?: string;
    infants?: string;
  };
}

export default function FlightInsightsPage({ searchParams }: PageProps) {
  const start = searchParams.start ?? '';
  const end   = searchParams.end   ?? '';

  const adults   = Math.max(1, parseInt(searchParams.adults   ?? '2') || 2);
  const children = Math.max(0, parseInt(searchParams.children ?? '1') || 0);
  const infants  = Math.max(0, parseInt(searchParams.infants  ?? '0') || 0);
  const childAges = (searchParams.childAges ?? '')
    .split(',')
    .filter(Boolean)
    .map(s => Math.max(2, Math.min(11, parseInt(s) || 5)))
    .slice(0, children);
  while (childAges.length < children) childAges.push(5);

  return (
    <FlightInsightsClient
      schoolContext={{
        school:     searchParams.school || searchParams.urn || 'Your school',
        borough:    searchParams.borough  || 'Your borough',
        breakLabel: searchParams.break    || 'Your break',
        dateRange:  start && end ? fmtDateRange(start, end) : '',
      }}
      party={{ adults, children, childAges, infants }}
    />
  );
}
