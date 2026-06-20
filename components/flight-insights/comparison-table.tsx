'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { CombinationsOnlyResult } from '@/lib/flights/assembleRecommendation';
import type { ScoredCombination } from '@/lib/flights/buildCandidates';

// ── Quality label mapping ────────────────────────────────────────────────────

function arrivalLabel(q: string | null, time: string | null): string {
  const t = time ? ` (${time})` : '';
  switch (q) {
    case 'excellent': return `Excellent${t}`;
    case 'good':      return `Good${t}`;
    case 'acceptable': return `Evening${t}`;
    case 'poor':      return `Night${t}`;
    default:          return '—';
  }
}

function outDepLabel(q: string | null, time: string | null): string {
  const t = time ? ` (${time})` : '';
  switch (q) {
    case 'ideal':      return `Ideal${t}`;
    case 'good':       return `Good${t}`;
    case 'very_early': return `Very early${t}`;
    case 'poor':       return `Late${t}`;
    default:           return '—';
  }
}

function retDepLabel(q: string | null, time: string | null): string {
  const t = time ? ` (${time})` : '';
  switch (q) {
    case 'excellent':  return `Excellent${t}`;
    case 'good':       return `Good${t}`;
    case 'early':      return `Early${t}`;
    case 'very_early': return `Very early${t}`;
    default:           return '—';
  }
}

// ── Cost helpers ─────────────────────────────────────────────────────────────

function gbp(n: number | null | undefined): string {
  if (n == null) return '—';
  return `£${Math.round(n).toLocaleString('en-GB')}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function transitModeLabel(transit: ScoredCombination['outbound_transit'] | null): string {
  if (!transit) return 'Transit';
  if (transit.recommended_mode === 'uber') return transit.uber.is_xl ? 'Uber XL' : 'Uber';
  if (transit.transit?.route_summary) {
    const summary = transit.transit.route_summary;
    if (/bus/i.test(summary)) return 'Bus';
    if (/coach/i.test(summary)) return 'Coach';
    if (/elizabeth|crossrail/i.test(summary)) return 'Elizabeth line';
    if (/thameslink/i.test(summary)) return 'Thameslink';
    if (/gatwick express/i.test(summary)) return 'Gatwick Express';
    if (/stansted express/i.test(summary)) return 'Stansted Express';
  }
  return 'Transit';
}

// ── Column data extraction ───────────────────────────────────────────────────

interface ColumnData {
  label: string;
  isWinner: boolean;
  isBaseline: boolean;
  outbound_date: string;
  return_date: string;
  trip_nights: number;
  is_inset_day: boolean;
  outbound_departure_quality: string | null;
  outbound_departure_time: string | null;
  arrival_quality: string | null;
  outbound_arrival_time: string | null;
  return_departure_quality: string | null;
  return_departure_time: string | null;
  outbound_carrier: string;
  return_carrier: string;
  origin_iata: string;
  out_dest_iata: string;
  ret_dest_iata: string;
  cabin_bag_cost_gbp: number;
  base_fare_gbp: number;
  bags_cost_gbp: number;
  out_transit_cost_gbp: number;
  ret_transit_cost_gbp: number;
  dest_transfer_gbp: number;
  total_cost_gbp: number;
  out_transit_mode: string;
  ret_transit_mode: string;
}

function extractColumn(
  c: ScoredCombination,
  label: string,
  isWinner: boolean,
  isBaseline: boolean,
): ColumnData {
  const baseFare = (c.outbound_fare_gbp ?? 0) + (c.return_fare_gbp ?? 0);
  const bagsCost = (c.fare_plus_ancillary_gbp ?? 0) - baseFare;
  return {
    label,
    isWinner,
    isBaseline,
    outbound_date: c.outbound_date,
    return_date: c.return_date,
    trip_nights: c.trip_nights,
    is_inset_day: c.is_inset_day,
    outbound_departure_quality: c.outbound_departure_quality,
    outbound_departure_time: c.outbound_departure_time?.slice(0, 5) ?? null,
    arrival_quality: c.arrival_quality,
    outbound_arrival_time: c.outbound_arrival_time?.slice(0, 5) ?? null,
    return_departure_quality: c.return_departure_quality,
    return_departure_time: c.return_departure_time?.slice(0, 5) ?? null,
    outbound_carrier: c.outbound_carrier,
    return_carrier: c.return_carrier,
    origin_iata: c.origin_iata,
    out_dest_iata: c.out_dest_iata,
    ret_dest_iata: c.ret_dest_iata,
    cabin_bag_cost_gbp: c.cabin_bag_cost_gbp,
    base_fare_gbp: baseFare,
    bags_cost_gbp: bagsCost,
    out_transit_cost_gbp: c.outbound_transit_cost_gbp,
    ret_transit_cost_gbp: c.return_transit_cost_gbp,
    dest_transfer_gbp: c.destination_transfer_cost_gbp,
    total_cost_gbp: c.total_cost_gbp,
    out_transit_mode: transitModeLabel(c.outbound_transit),
    ret_transit_mode: transitModeLabel(c.return_transit),
  };
}

// ── Carrier names ────────────────────────────────────────────────────────────

const CARRIER_NAMES: Record<string, string> = {
  FR: 'Ryanair', U2: 'easyJet', W6: 'Wizz Air', VY: 'Vueling',
  BA: 'British Airways', TP: 'TAP', LS: 'Jet2',
};

function carrierName(iata: string): string {
  return CARRIER_NAMES[iata] ?? iata;
}

// ── Row definitions ──────────────────────────────────────────────────────────

interface RowDef {
  key: string;
  label: string;
  group: 'itinerary' | 'quality' | 'costs';
  render: (col: ColumnData) => string;
  bold?: boolean;
  color?: (col: ColumnData) => string | undefined;
}

const ROWS: RowDef[] = [
  // Itinerary
  { key: 'dates', label: 'Dates', group: 'itinerary',
    render: c => `${formatDate(c.outbound_date)} → ${formatDate(c.return_date)}` },
  { key: 'nights', label: 'Nights', group: 'itinerary',
    render: c => `${c.trip_nights}` },
  { key: 'inset', label: 'Inset day', group: 'itinerary',
    render: c => c.is_inset_day ? 'Yes' : 'No' },
  { key: 'carrier', label: 'Carrier', group: 'itinerary',
    render: c => c.outbound_carrier === c.return_carrier
      ? carrierName(c.outbound_carrier)
      : `${carrierName(c.outbound_carrier)} / ${carrierName(c.return_carrier)}` },
  { key: 'airports', label: 'Route', group: 'itinerary',
    render: c => `${c.origin_iata} → ${c.out_dest_iata}` },
  // Quality
  { key: 'out_dep', label: 'Departure', group: 'quality',
    render: c => outDepLabel(c.outbound_departure_quality, c.outbound_departure_time) },
  { key: 'arrival', label: 'Arrival', group: 'quality',
    render: c => arrivalLabel(c.arrival_quality, c.outbound_arrival_time) },
  { key: 'ret_dep', label: 'Return', group: 'quality',
    render: c => retDepLabel(c.return_departure_quality, c.return_departure_time) },
  // Costs
  { key: 'fare', label: 'Flights', group: 'costs',
    render: c => gbp(c.base_fare_gbp) },
  { key: 'bags', label: 'Bags & seats', group: 'costs',
    render: c => c.cabin_bag_cost_gbp === 0 && c.bags_cost_gbp === 0 ? 'Included' : gbp(c.bags_cost_gbp),
    color: c => c.cabin_bag_cost_gbp === 0 && c.bags_cost_gbp === 0 ? '#5c7a6b' : undefined },
  { key: 'out_transit', label: 'To airport', group: 'costs',
    render: c => `${gbp(c.out_transit_cost_gbp)}` },
  { key: 'ret_transit', label: 'From airport', group: 'costs',
    render: c => `${gbp(c.ret_transit_cost_gbp)}` },
  { key: 'dest_transfer', label: 'Dest. transfer', group: 'costs',
    render: c => `${gbp(c.dest_transfer_gbp)}` },
  { key: 'total', label: 'Total all-in', group: 'costs', bold: true,
    render: c => gbp(c.total_cost_gbp) },
];

const GROUP_LABELS: Record<string, string> = {
  itinerary: 'Itinerary',
  quality: 'Quality',
  costs: 'Costs',
};

// ── Component ────────────────────────────────────────────────────────────────

interface ComparisonTableProps {
  result: CombinationsOnlyResult;
}

export function ComparisonTable({ result }: ComparisonTableProps) {
  const [open, setOpen] = useState(false);

  const { baseline, recommendation, shortlist, savingCategory, scoredPool } = result;
  const isBaselineCheapest = savingCategory === 'baseline_cheapest';

  const combinationCount = scoredPool.length;
  const airportSet = new Set(scoredPool.map(c => c.origin_iata));
  const airportCount = airportSet.size;

  // Find scored versions of recommendation and baseline
  const winnerScored = scoredPool.find(c =>
    c.outbound_date === recommendation.outbound_date &&
    c.return_date === recommendation.return_date &&
    c.outbound_carrier === recommendation.outbound_carrier &&
    c.return_carrier === recommendation.return_carrier,
  );

  const baselineScored = scoredPool.find(c => (c as any).is_baseline === true);

  // Build columns
  const columns: ColumnData[] = [];

  if (isBaselineCheapest && baselineScored) {
    columns.push(extractColumn(baselineScored, 'Recommended', true, true));
  } else {
    if (baselineScored) {
      columns.push(extractColumn(baselineScored, 'Baseline', false, true));
    }
    if (winnerScored) {
      columns.push(extractColumn(winnerScored, 'Recommended', true, false));
    }
  }

  // Add shortlist alternatives (skip if already shown as winner or baseline)
  const shownKeys = new Set(
    columns.map(c => `${c.outbound_date}_${c.return_date}_${c.outbound_carrier}`),
  );
  for (const s of shortlist) {
    const key = `${s.outbound_date}_${s.return_date}_${s.outbound_carrier}`;
    if (shownKeys.has(key)) continue;
    if (columns.length >= 5) break;
    columns.push(extractColumn(s, `Option ${columns.length}`, false, false));
    shownKeys.add(key);
  }

  if (columns.length < 2) return null;

  // Track group boundaries for visual separation
  let lastGroup = '';

  return (
    <section className="w-full">
      {/* Trigger */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-4 group text-left"
      >
        <div>
          <h3
            className="text-[22px] font-medium leading-[1.4] text-[#004349]"
            style={{ fontFamily: 'Newsreader, serif' }}
          >
            How we ranked your options
          </h3>
          <p className="text-sm text-[#6f797a] mt-1" style={{ fontFamily: 'Inter, sans-serif' }}>
            {combinationCount} combinations scored across {airportCount} London airport{airportCount !== 1 ? 's' : ''}
          </p>
        </div>
        <ChevronDown
          className={`w-5 h-5 text-[#6f797a] transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Table */}
      {open && (
        <div className="overflow-x-auto -mx-4 px-4 pb-6">
          <table className="w-full border-collapse text-sm" style={{ fontFamily: 'Inter, sans-serif', minWidth: columns.length * 160 + 140 }}>
            <thead>
              <tr>
                <th className="text-left py-3 px-3 text-[#6f797a] font-medium text-xs tracking-wide uppercase w-[140px]" />
                {columns.map((col, i) => (
                  <th
                    key={i}
                    className={`text-center py-3 px-3 font-semibold text-sm ${
                      col.isWinner
                        ? 'text-[#004349] bg-[#f0f7f7]'
                        : 'text-[#191c1d]'
                    }`}
                    style={col.isWinner ? { borderTop: '3px solid #004349' } : undefined}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => {
                const showGroupHeader = row.group !== lastGroup;
                lastGroup = row.group;

                return (
                  <tr key={row.key}>
                    {/* Row label — with group header inline */}
                    <td className={`py-2 px-3 text-[#3f484a] ${row.bold ? 'font-semibold' : ''} ${
                      showGroupHeader ? 'pt-5' : ''
                    }`}>
                      {showGroupHeader && (
                        <span className="block text-[10px] uppercase tracking-widest text-[#6f797a] font-medium mb-1">
                          {GROUP_LABELS[row.group]}
                        </span>
                      )}
                      {row.label}
                    </td>
                    {columns.map((col, i) => {
                      const cellColor = row.color?.(col);
                      return (
                        <td
                          key={i}
                          className={`py-2 px-3 text-center ${
                            row.bold ? 'font-bold text-[#191c1d]' : 'text-[#3f484a]'
                          } ${col.isWinner ? 'bg-[#f0f7f7]/50' : ''} ${
                            showGroupHeader ? 'pt-5' : ''
                          }`}
                          style={cellColor ? { color: cellColor } : undefined}
                        >
                          {row.render(col)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
