'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { CombinationsOnlyResult, AssembledCombination } from '@/lib/flights/assembleRecommendation';
import { computeQualityFields } from '@/lib/flights/buildCandidates';

// ── Quality label mapping ────────────────────────────────────────────────────

const AMBER_QUALITIES = new Set(['very_early', 'poor', 'early', 'acceptable']);

function qualityPill(label: string, q: string | null, time: string | null): ReactNode {
  const timeStr = time ? ` (${time})` : '';
  if (!q) return '—';
  if (AMBER_QUALITIES.has(q)) {
    return (
      <span>
        <span
          className="inline-block rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{ background: '#fef3c7', color: '#92400e' }}
        >
          {label}
        </span>
        {timeStr && <span className="text-[#6f797a] text-[11px] ml-1">{timeStr}</span>}
      </span>
    );
  }
  return <span className="text-[#3f484a]">{label}{timeStr}</span>;
}

function arrivalNode(q: string | null, time: string | null): ReactNode {
  const labels: Record<string, string> = {
    excellent: 'Excellent', good: 'Good', acceptable: 'Evening', poor: 'Night',
  };
  return qualityPill(labels[q ?? ''] ?? '—', q, time);
}

function outDepNode(q: string | null, time: string | null): ReactNode {
  const labels: Record<string, string> = {
    ideal: 'Ideal', good: 'Good', very_early: 'Very early', poor: 'Late',
  };
  return qualityPill(labels[q ?? ''] ?? '—', q, time);
}

function retDepNode(q: string | null, time: string | null): ReactNode {
  const labels: Record<string, string> = {
    excellent: 'Excellent', good: 'Good', early: 'Early', very_early: 'Very early',
  };
  return qualityPill(labels[q ?? ''] ?? '—', q, time);
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

function transitModeLabel(transit: AssembledCombination['outbound_transit'] | null): string {
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

// ── Carrier names ────────────────────────────────────────────────────────────

const CARRIER_NAMES: Record<string, string> = {
  FR: 'Ryanair', U2: 'easyJet', W6: 'Wizz Air', VY: 'Vueling',
  BA: 'British Airways', TP: 'TAP', LS: 'Jet2',
};

function carrierName(iata: string): string {
  return CARRIER_NAMES[iata] ?? iata;
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
  checked_bag_cost_gbp: number;
  seat_cost_gbp: number;
  base_fare_gbp: number;
  out_transit_cost_gbp: number;
  ret_transit_cost_gbp: number;
  dest_transfer_gbp: number;
  dest_transfer_known: boolean;
  dest_transfer_is_taxi: boolean;
  dest_transit_duration_mins: number | null;
  dest_transit_changes: number | null;
  dest_taxi_duration_mins: number | null;
  dest_transit_notes: string | null;
  dest_taxi_cost_low_gbp: number | null;
  dest_taxi_cost_high_gbp: number | null;
  requires_absence: boolean;
  total_cost_gbp: number;
  total_inc_fine: number;
  fine_gbp: number;
  out_transit_mode: string;
  ret_transit_mode: string;
  outbound_transit: AssembledCombination['outbound_transit'];
  return_transit: AssembledCombination['return_transit'];
}

function extractColumn(
  c: AssembledCombination,
  label: string,
  isWinner: boolean,
  isBaseline: boolean,
): ColumnData {
  const quality = computeQualityFields(c);
  const baseFare = (c.outbound_fare_gbp ?? 0) + (c.return_fare_gbp ?? 0);
  return {
    label,
    isWinner,
    isBaseline,
    outbound_date: c.outbound_date,
    return_date: c.return_date,
    trip_nights: quality.trip_nights,
    is_inset_day: c.is_inset_day,
    outbound_departure_quality: quality.outbound_departure_quality,
    outbound_departure_time: c.outbound_departure_time?.slice(0, 5) ?? null,
    arrival_quality: quality.arrival_quality,
    outbound_arrival_time: c.outbound_arrival_time?.slice(0, 5) ?? null,
    return_departure_quality: quality.return_departure_quality,
    return_departure_time: c.return_departure_time?.slice(0, 5) ?? null,
    outbound_carrier: c.outbound_carrier,
    return_carrier: c.return_carrier,
    origin_iata: c.origin_iata,
    out_dest_iata: c.out_dest_iata,
    ret_dest_iata: c.ret_dest_iata,
    cabin_bag_cost_gbp: c.cabin_bag_cost_gbp,
    checked_bag_cost_gbp: c.checked_bag_cost_gbp,
    seat_cost_gbp: c.seat_cost_gbp,
    base_fare_gbp: baseFare,
    out_transit_cost_gbp: c.outbound_transit_cost_gbp,
    ret_transit_cost_gbp: c.return_transit_cost_gbp,
    dest_transfer_gbp: c.destination_transfer_cost_gbp,
    dest_transfer_known: c.destination_transfer_known,
    dest_transfer_is_taxi: c.destination_transfer_is_taxi,
    dest_transit_duration_mins: c.destination_transit_duration_mins,
    dest_transit_changes: c.destination_transit_changes,
    dest_taxi_duration_mins: c.destination_taxi_duration_mins,
    dest_transit_notes: c.destination_transit_notes,
    dest_taxi_cost_low_gbp: c.destination_taxi_cost_low_gbp,
    dest_taxi_cost_high_gbp: c.destination_taxi_cost_high_gbp,
    requires_absence: c.requires_absence,
    total_cost_gbp: c.total_cost_gbp,
    total_inc_fine: c.total_inc_fine,
    fine_gbp: c.fine_gbp ?? 0,
    out_transit_mode: transitModeLabel(c.outbound_transit),
    ret_transit_mode: transitModeLabel(c.return_transit),
    outbound_transit: c.outbound_transit,
    return_transit: c.return_transit,
  };
}

// ── Row definitions ──────────────────────────────────────────────────────────

interface RowDef {
  key: string;
  label: string;
  group: 'itinerary' | 'quality' | 'costs';
  renderNode: (col: ColumnData) => ReactNode;
  bold?: boolean;
  dynamicLabel?: (cols: ColumnData[]) => string;
  mergeable?: boolean;
}

function roundTo5(mins: number): number {
  return Math.round(mins / 5) * 5;
}

function londonTransitDetail(
  transit: AssembledCombination['outbound_transit'] | null,
): ReactNode {
  if (!transit) return null;

  const modeLabel = transitModeLabel(transit);

  if (transit.recommended_mode === 'uber') {
    const duration = roundTo5(transit.uber.duration_mins);
    const parts: string[] = [modeLabel, `~${duration} min`];
    const low = gbp(transit.uber.low_pence / 100);
    const high = gbp(transit.uber.high_pence / 100);
    return (
      <>
        <span className="block text-[11px] text-[#6f797a] font-normal mt-0.5">
          {parts.join(' · ')}
        </span>
        <span className="block text-[11px] text-[#6f797a] font-normal mt-0.5">
          {low} – {high}
        </span>
        {transit.uber.early_morning_surge_warning && (
          <span className="block text-[11px] font-normal mt-0.5" style={{ color: '#805600' }}>
            Surge pricing likely
          </span>
        )}
      </>
    );
  }

  const t = transit.transit;
  if (!t) return null;

  const duration = roundTo5(t.duration_mins);
  const parts: string[] = [];
  parts.push(modeLabel === 'Transit' ? 'Train' : modeLabel);
  parts.push(`~${duration} min`);
  if (t.changes > 0) parts.push(`${t.changes} change${t.changes > 1 ? 's' : ''}`);
  if (t.confidence === 'estimated') parts.push('(estimate)');

  return (
    <>
      <span className="block text-[11px] text-[#6f797a] font-normal mt-0.5">
        {parts.join(' · ')}
      </span>
      {t.early_flight_warning && (
        <span className="block text-[11px] font-normal mt-0.5" style={{ color: '#805600' }}>
          Check first train time
        </span>
      )}
    </>
  );
}

function destTransferDetail(col: ColumnData): ReactNode {
  if (col.dest_transfer_is_taxi) {
    const parts: string[] = ['Taxi'];
    if (col.dest_taxi_duration_mins != null) parts.push(`~${col.dest_taxi_duration_mins} min`);
    if (col.dest_taxi_cost_low_gbp != null && col.dest_taxi_cost_high_gbp != null) {
      parts.push(`£${Math.round(col.dest_taxi_cost_low_gbp)}–£${Math.round(col.dest_taxi_cost_high_gbp)}`);
    }
    if (!col.dest_transfer_known) parts.push('(estimate)');
    return (
      <span className="block text-[11px] text-[#6f797a] font-normal mt-0.5">
        {parts.join(' · ')}
      </span>
    );
  }

  const duration = col.dest_transit_duration_mins ?? col.dest_taxi_duration_mins;
  if (duration == null && col.dest_transfer_known && !col.dest_transit_notes) return null;

  const parts: string[] = [];
  if (col.dest_transit_notes) parts.push(col.dest_transit_notes);
  if (duration != null) parts.push(`~${duration} min`);
  if (col.dest_transit_changes != null && col.dest_transit_changes > 0) {
    parts.push(`${col.dest_transit_changes} change${col.dest_transit_changes > 1 ? 's' : ''}`);
  }
  if (!col.dest_transfer_known) parts.push('(estimate)');
  if (parts.length === 0) return null;

  return (
    <span className="block text-[11px] text-[#6f797a] font-normal mt-0.5">
      {parts.join(' · ')}
    </span>
  );
}

function bagCell(cost: number, cabinIncluded: boolean): ReactNode {
  if (cabinIncluded && cost === 0) return <span style={{ color: '#5c7a6b' }}>Included</span>;
  if (cost === 0) return '—';
  return gbp(cost);
}

const ROWS: RowDef[] = [
  // Itinerary (dates and carrier now live in the column header)
  { key: 'nights', label: 'Nights', group: 'itinerary',
    renderNode: c => `${c.trip_nights}` },
  { key: 'route', label: 'Route', group: 'itinerary',
    renderNode: c => {
      if (c.origin_iata === c.ret_dest_iata) {
        return `${c.origin_iata} → ${c.out_dest_iata}`;
      }
      return (
        <>
          <span className="block">{c.origin_iata} → {c.out_dest_iata}</span>
          <span className="block">{c.out_dest_iata} → {c.ret_dest_iata}</span>
        </>
      );
    } },
  // Quality
  { key: 'out_dep', label: 'Departure', group: 'quality',
    renderNode: c => outDepNode(c.outbound_departure_quality, c.outbound_departure_time) },
  { key: 'arrival', label: 'Arrival', group: 'quality',
    renderNode: c => arrivalNode(c.arrival_quality, c.outbound_arrival_time) },
  { key: 'ret_dep', label: 'Return', group: 'quality',
    renderNode: c => retDepNode(c.return_departure_quality, c.return_departure_time) },
  // Costs
  { key: 'fare', label: 'Flights', group: 'costs',
    renderNode: c => gbp(c.base_fare_gbp) },
  { key: 'cabin_bags', label: 'Cabin bags', group: 'costs',
    renderNode: c => bagCell(c.cabin_bag_cost_gbp, c.cabin_bag_cost_gbp === 0) },
  { key: 'checked_bags', label: 'Checked bags', group: 'costs', mergeable: true,
    renderNode: c => c.checked_bag_cost_gbp === 0
      ? (<>
          <span className="text-[#6f797a]">0 assumed</span>
          <span className="block text-[11px] text-[#6f797a] font-normal mt-0.5">Change baggage selection above to recalculate.</span>
        </>)
      : gbp(c.checked_bag_cost_gbp) },
  { key: 'seats', label: 'Seats', group: 'costs', mergeable: true,
    renderNode: c => c.seat_cost_gbp === 0
      ? (<>
          <span className="text-[#6f797a]">Allocated at check-in</span>
          <span className="block text-[11px] text-[#6f797a] font-normal mt-0.5">Pay extra above to guarantee seats together in advance.</span>
        </>)
      : gbp(c.seat_cost_gbp) },
  { key: 'out_transit', label: 'To airport', group: 'costs',
    renderNode: c => (
      <>
        {gbp(c.out_transit_cost_gbp)}
        {londonTransitDetail(c.outbound_transit)}
      </>
    ),
    dynamicLabel: (cols) => `To ${cols.find(c => c.isWinner)?.outbound_transit?.airport_iata ?? 'airport'}`,
  },
  { key: 'ret_transit', label: 'From airport', group: 'costs',
    renderNode: c => (
      <>
        {gbp(c.ret_transit_cost_gbp)}
        {londonTransitDetail(c.return_transit)}
      </>
    ),
    dynamicLabel: (cols) => `From ${cols.find(c => c.isWinner)?.return_transit?.airport_iata ?? 'airport'}`,
  },
  { key: 'dest_transfer', label: 'Dest. transfer', group: 'costs',
    renderNode: c => (
      <>
        {gbp(c.dest_transfer_gbp)}
        {destTransferDetail(c)}
      </>
    ) },
  { key: 'total', label: 'Total all-in', group: 'costs', bold: true,
    renderNode: c => (
      <>
        {gbp(c.total_inc_fine)}
        {c.fine_gbp > 0 && (
          <span className="block text-[11px] font-normal mt-0.5" style={{ color: '#92400e' }}>
            Includes {gbp(c.fine_gbp)} school absence fine
          </span>
        )}
      </>
    ) },
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

  const { baselineAsCombination, recommendation, shortlist, savingCategory, scoredPool } = result;
  const isBaselineCheapest = savingCategory === 'baseline_cheapest';

  const combinationCount = scoredPool.length;
  const londonAirportSet = new Set(scoredPool.map(c => c.origin_iata));
  const londonAirportCount = londonAirportSet.size;

  // Build columns directly from result props — no scoredPool lookups
  const columns: ColumnData[] = [];

  if (isBaselineCheapest && baselineAsCombination) {
    columns.push(extractColumn(baselineAsCombination, 'Recommended', true, true));
  } else {
    if (baselineAsCombination) {
      columns.push(extractColumn(baselineAsCombination, 'Baseline', false, true));
    }
    columns.push(extractColumn(recommendation, 'Recommended', true, false));
  }

  // Add shortlist alternatives (skip if already shown as winner or baseline)
  const shownKeys = new Set(
    columns.map(c => `${c.outbound_date}_${c.return_date}_${c.outbound_carrier}`),
  );
  const shortlistColumns: ColumnData[] = [];
  for (const s of shortlist) {
    const key = `${s.outbound_date}_${s.return_date}_${s.outbound_carrier}`;
    if (shownKeys.has(key)) continue;
    if (columns.length + shortlistColumns.length >= 5) break;
    shortlistColumns.push(extractColumn(s, '', false, false));
    shownKeys.add(key);
  }

  columns.push(...shortlistColumns);

  // Re-derive all column labels using slot priority rules
  const winnerCol = columns.find(c => c.isWinner);
  const winnerOrigin = winnerCol?.origin_iata;
  const usedLabels = new Set<string>();
  const nonWinnerCosts = columns.filter(c => !c.isWinner).map(c => c.total_cost_gbp);
  const lowestNonWinnerCost = nonWinnerCosts.length > 0 ? Math.min(...nonWinnerCosts) : Infinity;
  let optionIdx = 1;
  for (const col of columns) {
    if (col.isWinner) {
      col.label = 'Recommended';
    } else if (col.is_inset_day && !usedLabels.has('Inset day option')) {
      col.label = 'Inset day option';
    } else if (winnerOrigin && col.origin_iata !== winnerOrigin) {
      col.label = 'Different airport';
    } else if (col.total_cost_gbp === lowestNonWinnerCost && !usedLabels.has('Lowest fare')) {
      col.label = 'Lowest fare';
    } else {
      col.label = `Option ${optionIdx}`;
      optionIdx++;
    }
    usedLabels.add(col.label);
  }

  if (columns.length > 0) {
    const c0 = columns[0];
    console.log('[comparison-table] dest transfer fields (col 0):', {
      dest_transfer_is_taxi: c0.dest_transfer_is_taxi,
      dest_transfer_known: c0.dest_transfer_known,
      dest_transfer_gbp: c0.dest_transfer_gbp,
      dest_transit_notes: c0.dest_transit_notes,
      dest_transit_duration_mins: c0.dest_transit_duration_mins,
      dest_transit_changes: c0.dest_transit_changes,
      dest_taxi_duration_mins: c0.dest_taxi_duration_mins,
      dest_taxi_cost_low_gbp: c0.dest_taxi_cost_low_gbp,
      dest_taxi_cost_high_gbp: c0.dest_taxi_cost_high_gbp,
    });
  }

  const destAirportCount = new Set(scoredPool.map(c => c.out_dest_iata)).size;

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
            {combinationCount} combinations scored across {londonAirportCount} London airport{londonAirportCount !== 1 ? 's' : ''} and {destAirportCount} Barcelona-area airport{destAirportCount !== 1 ? 's' : ''}
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
                    className={`text-center py-3 px-3 align-bottom ${
                      col.isWinner
                        ? 'bg-[#f0f7f7]'
                        : ''
                    }`}
                    style={col.isWinner ? { borderTop: '3px solid #004349' } : undefined}
                  >
                    <span className={`block font-semibold text-sm ${col.isWinner ? 'text-[#004349]' : 'text-[#191c1d]'}`}>
                      {col.label}
                    </span>
                    <span className="block text-xs text-[#3f484a] font-medium mt-1">
                      {formatDate(col.outbound_date)} → {formatDate(col.return_date)}
                    </span>
                    <span className="block text-[11px] text-[#6f797a] font-normal mt-0.5">
                      {col.outbound_carrier === col.return_carrier
                        ? carrierName(col.outbound_carrier)
                        : `${carrierName(col.outbound_carrier)} · ${carrierName(col.return_carrier)}`}
                    </span>
                    {(col.fine_gbp > 0 || col.requires_absence) && (
                      <span className="block text-[11px] font-normal mt-0.5" style={{ color: '#ba1a1a' }}>
                        School absence required
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => {
                const showGroupHeader = row.group !== lastGroup;
                lastGroup = row.group;
                const rowLabel = row.dynamicLabel ? row.dynamicLabel(columns) : row.label;

                const isUniform = row.mergeable && columns.length > 1 &&
                  columns.every(c => {
                    const key = row.key === 'checked_bags' ? c.checked_bag_cost_gbp : c.seat_cost_gbp;
                    const firstKey = row.key === 'checked_bags' ? columns[0].checked_bag_cost_gbp : columns[0].seat_cost_gbp;
                    return key === firstKey;
                  });

                return (
                  <tr key={row.key}>
                    <td className={`py-2 px-3 text-[#3f484a] ${row.bold ? 'font-semibold' : ''} ${
                      showGroupHeader ? 'pt-5' : ''
                    }`}>
                      {showGroupHeader && (
                        <span className="block text-[10px] uppercase tracking-widest text-[#6f797a] font-medium mb-1">
                          {GROUP_LABELS[row.group]}
                        </span>
                      )}
                      {rowLabel}
                    </td>
                    {isUniform ? (
                      <td
                        colSpan={columns.length}
                        className={`py-2 px-3 text-center text-[#3f484a] ${
                          showGroupHeader ? 'pt-5' : ''
                        }`}
                      >
                        {row.renderNode(columns[0])}
                      </td>
                    ) : (
                      columns.map((col, i) => (
                        <td
                          key={i}
                          className={`py-2 px-3 text-center ${
                            row.bold ? 'font-bold text-[#191c1d]' : 'text-[#3f484a]'
                          } ${col.isWinner ? 'bg-[#f0f7f7]/50' : ''} ${
                            showGroupHeader ? 'pt-5' : ''
                          }`}
                        >
                          {row.renderNode(col)}
                        </td>
                      ))
                    )}
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
