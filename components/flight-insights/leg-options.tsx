'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LegOption {
  airline_iata: string;
  airline_name: string;
  origin_iata: string;
  destination_iata: string;
  departure_time: string;
  arrival_time: string;
  duration_minutes: number;
  stops: number;
  fare_gbp: number;
  cabin_bag_cost_gbp: number;
  checked_bag_cost_gbp: number;
  seat_cost_gbp: number;
  // Raw pence values from RPC — kept for display only, not used for cost math
  transit_offpeak_fare_pence: number | null;
  transit_peak_fare_pence: number | null;
  uber_low_pence: number | null;
  uber_high_pence: number | null;
  // Family-adjusted transit cost — computed server-side via the canonical
  // lib/flights/transitCost.ts and attached to each option before reaching this component.
  transit_cost_gbp: number | null;
  transit_method: string | null;
  transit_duration_mins: number | null;
  transit_changes: number | null;
  destination_transfer_gbp: number;
  total_gbp: number;
  baggage_is_estimate: boolean;
  family_split_risk: boolean;
}

interface RecommendedOption {
  airline_iata: string;
  origin_iata: string;
  destination_iata: string;
  departure_time: string;
}

interface LegOptionsProps {
  data: {
    date: string;
    direction: 'outbound' | 'return';
    options: LegOption[];
  } | null;
  title: string;
  recommendedOption?: RecommendedOption | null;
  adults: number;
  children: number;
  infants: number;
  transitPreference: 'auto' | 'uber' | 'transit';
  postcodeDistrict: string | null;
  selectedDate: string;
  smartDate: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ancillaryGbp(opt: LegOption): number {
  return opt.cabin_bag_cost_gbp + opt.checked_bag_cost_gbp + opt.seat_cost_gbp;
}

// Exported so leg-options-modal.tsx's "Book these dates" button can build
// its link from exactly the same option this component badges CHEAPEST —
// same total_gbp formula as the inline computation in LegOptions below
// (fare + ancillary + transit + destination transfer). Options here arrive
// without total_gbp populated yet (that's computed client-side, hence this
// function), so it's derived fresh rather than trusting the LegOption type's
// total_gbp field.
export function getCheapestOption(
  data: { options: LegOption[] } | null | undefined,
): (LegOption & { total_gbp: number }) | null {
  if (!data?.options?.length) return null;
  const processed = data.options.map(opt => ({
    ...opt,
    total_gbp: opt.fare_gbp + ancillaryGbp(opt) + (opt.transit_cost_gbp ?? 0) + opt.destination_transfer_gbp,
  }));
  processed.sort((a, b) => a.total_gbp - b.total_gbp);
  return processed[0];
}


function gbp(n: number): string {
  return `£${Math.round(n).toLocaleString('en-GB')}`;
}

function formatDate(iso: string): string {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const d = new Date(iso + 'T00:00:00');
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function directionLabel(direction: 'outbound' | 'return'): string {
  return direction === 'outbound' ? 'Outbound options' : 'Return options';
}

function fmt(time: string): string {
  return time.slice(0, 5);
}

function extractTransitMode(method: string | null, durationMins: number | null): string {
  if (!method) return '—';
  const segments = method
    .split('→')
    .map(s => s.replace(/\([^)]+\)/g, '').trim())
    .filter(s => {
      const lower = s.toLowerCase();
      return (
        lower.includes('line') ||
        lower.includes('express') ||
        lower.includes('dlr') ||
        lower.includes('elizabeth') ||
        lower.includes('overground') ||
        lower.includes('national express') ||
        lower.includes('buses route') ||
        lower.includes('uber') ||
        lower.includes('bus')
      );
    });
  const route = segments.length > 0
    ? segments.join(' → ')
    : method.split('→')[0].trim().slice(0, 30);
  return durationMins ? `${route} · ${durationMins} min` : route;
}

// ── Expandable row detail ─────────────────────────────────────────────────────

function RowDetail({ opt }: { opt: LegOption }) {
  const rows: Array<{ label: string; value: string; bold?: boolean }> = [
    { label: 'Base fare',    value: gbp(opt.fare_gbp) },
    { label: 'Cabin bags',   value: opt.cabin_bag_cost_gbp   === 0 ? 'Included'     : gbp(opt.cabin_bag_cost_gbp) },
    { label: 'Checked bags', value: opt.checked_bag_cost_gbp === 0 ? 'None'         : gbp(opt.checked_bag_cost_gbp) },
    { label: 'Seats',        value: opt.seat_cost_gbp        === 0 ? 'Not selected' : gbp(opt.seat_cost_gbp) },
    {
      label: opt.transit_method ? `Transport (${opt.transit_method})` : 'Transport',
      value: opt.transit_cost_gbp != null ? gbp(opt.transit_cost_gbp) : '—',
    },
    { label: 'Dest. transfer', value: gbp(opt.destination_transfer_gbp) },
    { label: 'Total',          value: gbp(opt.total_gbp), bold: true },
  ];

  return (
    <div style={{
      marginTop: 10,
      padding: '12px 14px',
      background: '#f8fafa',
      borderRadius: 8,
      fontFamily: 'Inter, sans-serif',
    }}>
      <div style={{ fontSize: 12, color: '#004349', marginBottom: 8 }}>
        {opt.airline_name} {opt.origin_iata} → {opt.destination_iata}
        {' · '}{fmt(opt.departure_time)} · {opt.duration_minutes} min
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{
                fontSize: 12, color: '#3f484a', padding: '3px 0',
                fontWeight: r.bold ? 700 : 400,
                borderTop: r.bold ? '1px solid #d4dbdc' : undefined,
                paddingTop: r.bold ? 8 : undefined,
              }}>
                {r.label}
              </td>
              <td style={{
                fontSize: 12, color: '#3f484a', padding: '3px 0',
                textAlign: 'right',
                fontWeight: r.bold ? 700 : 400,
                borderTop: r.bold ? '1px solid #d4dbdc' : undefined,
                paddingTop: r.bold ? 8 : undefined,
              }}>
                {r.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {opt.baggage_is_estimate && (
        <p style={{ fontSize: 10, color: '#6f797a', margin: '8px 0 0', lineHeight: 1.4 }}>
          * Bag fees estimated — Ryanair/Wizz fees vary by route
        </p>
      )}
    </div>
  );
}

// ── Ancillary tooltip ─────────────────────────────────────────────────────────

function AncillaryTooltip({ opt }: { opt: LegOption }) {
  return (
    <div style={{
      position: 'absolute',
      bottom: 'calc(100% + 6px)',
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#1a2526',
      color: '#ffffff',
      fontSize: 11,
      padding: '6px 10px',
      borderRadius: 6,
      whiteSpace: 'nowrap',
      zIndex: 10,
      pointerEvents: 'none',
    }}>
      Cabin: {gbp(opt.cabin_bag_cost_gbp)} · Checked: {gbp(opt.checked_bag_cost_gbp)} · Seats: {gbp(opt.seat_cost_gbp)}
    </div>
  );
}

// ── Table component ───────────────────────────────────────────────────────────
// Extracted to avoid duplication between London and destination airport tables.

interface LeverTableProps {
  groups: LeverGroup[];
  getAirportIata: (o: ProcessedOption) => string;
  getDestIata: (o: ProcessedOption) => string;
  direction: 'outbound' | 'return';
  transitPreference: 'auto' | 'uber' | 'transit';
}

function LeverTable({
  groups,
  getAirportIata,
  getDestIata,
  direction,
  transitPreference,
}: LeverTableProps) {
  return (
    <table style={{
      width: '100%',
      borderCollapse: 'collapse',
      border: '1px solid #e8edee',
      borderRadius: 10,
      overflow: 'hidden',
      tableLayout: 'fixed',
    }}>
      <colgroup>
        <col style={{ width: '52px' }} />
        <col style={{ width: '180px' }} />
        <col style={{ width: '64px' }} />
        <col style={{ width: '84px' }} />
        <col style={{ width: '140px' }} />
        <col style={{ width: '80px' }} />
        <col style={{ width: '72px' }} />
      </colgroup>
      <thead>
        <tr>
          {/* Badge col — no header */}
          <th style={{
            padding: '8px 4px 10px',
            borderBottom: '1px solid #bfc8c9',
            verticalAlign: 'middle',
          }} />
          {/* Route col — no header */}
          <th style={{
            padding: '8px 12px 10px 0',
            borderBottom: '1px solid #bfc8c9',
            verticalAlign: 'middle',
          }} />
          {(['Fare', 'Bags & seats', 'Transport', 'Dest.', 'Total'] as const).map((h, i) => (
            <th key={h} style={{
              fontSize: 9,
              fontWeight: 600,
              color: '#6f797a',
              letterSpacing: '0.05em',
              textTransform: 'uppercase' as const,
              padding: '8px 0 10px',
              borderBottom: '1px solid #bfc8c9',
              // Transport col is left-aligned with left padding; all others center-aligned
              textAlign: i === 2 ? 'left' : 'center',
              paddingLeft: i === 2 ? 8 : 0,
              verticalAlign: 'middle',
            }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {groups.map((group, i) => (
          <LeverRow
            key={`${getAirportIata(group.displayRow)}-${group.displayRow.airline_iata}`}
            opt={group.displayRow}
            airportIata={getAirportIata(group.displayRow)}
            destCityIata={getDestIata(group.displayRow)}
            isCheapestRow={i === 0}
            isFirst={i === 0}
            transitPreference={transitPreference}
            direction={direction}
          />
        ))}
      </tbody>
    </table>
  );
}

// ── Lever row ─────────────────────────────────────────────────────────────────

function LeverRow({
  opt,
  airportIata,
  destCityIata,
  isCheapestRow,
  isFirst,
  transitPreference,
  direction,
}: {
  opt: LegOption;
  airportIata: string;
  destCityIata: string;
  isCheapestRow: boolean;
  isFirst: boolean;
  transitPreference: 'auto' | 'uber' | 'transit';
  direction: 'outbound' | 'return';
}) {
  const [expanded, setExpanded] = useState(false);
  const [showTooltip, setTooltip] = useState(false);
  const anc  = ancillaryGbp(opt);
  const cost = (opt as ProcessedOption).transit_cost_gbp ?? 0;

  const bg = isCheapestRow ? '#f0f8f9' : undefined;
  const toggle       = () => setExpanded((v: boolean) => !v);

  const tdBase = {
    backgroundColor: bg,
    cursor: 'pointer',
    paddingTop: 10,
    paddingBottom: 10,
    verticalAlign: 'middle',
  };

  return (
    <>
      {/* Separator */}
      {!isFirst && (
        <tr>
          <td colSpan={7} style={{ borderBottom: '1px solid #e8edee', padding: 0, height: 1 }} />
        </tr>
      )}

      {/* CHEAPEST badge row — driven solely by isCheapestRow */}
      {isCheapestRow && (
        <tr>
          <td colSpan={7} style={{
            backgroundColor: bg,
            fontSize: 9,
            fontWeight: 700,
            color: '#004349',
            letterSpacing: '0.05em',
            textTransform: 'uppercase' as const,
            paddingTop: 8,
            paddingBottom: 2,
            paddingLeft: 4,
            verticalAlign: 'middle',
          }}>
            Cheapest
          </td>
        </tr>
      )}

      {/* Main data row */}
      <tr onClick={toggle} style={{ cursor: 'pointer' }}>

        {/* Col 1: Airport badge */}
        <td style={{
          ...tdBase,
          borderLeft: isCheapestRow ? '3px solid #004349' : '3px solid transparent',
          paddingRight: 8,
          paddingLeft: 4,
        }}>
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 6,
            background: isCheapestRow ? '#004349' : '#e1e3e3',
            color: isCheapestRow ? '#ffffff' : '#3f484a',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.03em',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {airportIata}
          </div>
        </td>

        {/* Col 2: Airline + route */}
        <td style={{ ...tdBase, paddingRight: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1a2526', lineHeight: 1.3 }}>
            {opt.airline_name}
          </div>
          <div style={{ fontSize: 10, color: '#6f797a', lineHeight: 1.5 }}>
            <span>{opt.origin_iata} → {opt.destination_iata}</span>
            <br />
            <span>{fmt(opt.departure_time)}–{fmt(opt.arrival_time)} · {opt.duration_minutes} min</span>
          </div>
        </td>

        {/* Col 3: Fare */}
        <td style={{ ...tdBase, textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a2526' }}>
            {gbp(opt.fare_gbp)}
          </div>
        </td>

        {/* Col 4: Bags + seats */}
        <td style={{ ...tdBase, textAlign: 'center' }}>
          <div
            style={{ position: 'relative', display: 'inline-block' }}
            onMouseEnter={() => setTooltip(true)}
            onMouseLeave={() => setTooltip(false)}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1a2526' }}>{gbp(anc)}</div>
            <div style={{ fontSize: 10, color: '#6f797a', lineHeight: 1.3 }}>bags+seats</div>
            {showTooltip && <AncillaryTooltip opt={opt} />}
          </div>
        </td>

        {/* Col 5: Transport */}
        <td style={{ ...tdBase, paddingLeft: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a2526' }}>{gbp(cost)}</div>
          <div style={{ fontSize: 10, color: '#3f484a', lineHeight: 1.3 }}>
            {transitPreference === 'uber' ? 'Uber (estimated)' : extractTransitMode(opt.transit_method, opt.transit_duration_mins)}
          </div>
        </td>

        {/* Col 6: Destination transfer */}
        <td style={{ ...tdBase, textAlign: 'center' }}>
          {opt.destination_transfer_gbp > 0 ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1a2526' }}>
                {gbp(opt.destination_transfer_gbp)}
              </div>
              <div style={{ fontSize: 10, color: '#6f797a', lineHeight: 1.3 }}>transfer</div>
            </>
          ) : (
            <span style={{ fontSize: 12, color: '#6f797a' }}>—</span>
          )}
        </td>

        {/* Col 7: Total */}
        <td style={{
          ...tdBase,
          textAlign: 'center',
          fontSize: 15,
          fontWeight: 700,
          color: isCheapestRow ? '#004349' : '#191c1d',
        }}>
          {gbp((opt as ProcessedOption).total_gbp)}
        </td>
      </tr>

      {/* Expanded detail */}
      {expanded && (
        <tr>
          <td colSpan={7} style={{ paddingBottom: 12, backgroundColor: bg }}>
            <RowDetail opt={opt} />
          </td>
        </tr>
      )}
    </>
  );
}

// ── Lever group builder ───────────────────────────────────────────────────────

type ProcessedOption = LegOption & { transit_cost_gbp: number; total_gbp: number };

interface LeverGroup {
  airportIata: string;
  displayRow:  ProcessedOption;
}

function buildLeverGroups(
  opts:       ProcessedOption[],
  getAirport: (o: ProcessedOption) => string,
): LeverGroup[] {
  const groupMap = new Map<string, ProcessedOption[]>();
  for (const opt of opts) {
    const ap = getAirport(opt);
    if (!groupMap.has(ap)) groupMap.set(ap, []);
    groupMap.get(ap)!.push(opt);
  }

  const groups: LeverGroup[] = [];
  for (const [airportIata, members] of groupMap) {
    const cheapest = [...members].sort((a, b) => a.total_gbp - b.total_gbp)[0];
    groups.push({ airportIata, displayRow: cheapest });
  }

  groups.sort((a, b) => a.displayRow.total_gbp - b.displayRow.total_gbp);
  return groups;
}

// ── Main component ────────────────────────────────────────────────────────────

export function LegOptions({
  data,
  title,
  adults,
  children,
  transitPreference,
  selectedDate,
  smartDate,
}: LegOptionsProps) {
  // Default open — the data is the product
  const [open, setOpen] = useState(true);

  const direction = data?.direction ?? 'outbound';

  // transit_cost_gbp arrives pre-computed (via the canonical lib/flights/transitCost.ts,
  // server-side) — just total and re-sort.
  const processedOptions: ProcessedOption[] = (data?.options ?? []).map((opt) => {
    const transitCost = opt.transit_cost_gbp ?? 0;
    const totalGbp =
      opt.fare_gbp +
      ancillaryGbp(opt) +
      transitCost +
      opt.destination_transfer_gbp;
    return {
      ...opt,
      transit_cost_gbp: transitCost,
      total_gbp:        totalGbp,
    };
  });
  processedOptions.sort((a, b) => a.total_gbp - b.total_gbp);

  function getLondonIata(o: ProcessedOption): string {
    return direction === 'outbound' ? o.origin_iata : o.destination_iata;
  }
  function getDestIata(o: ProcessedOption): string {
    return direction === 'outbound' ? o.destination_iata : o.origin_iata;
  }

  const isSmartDate   = selectedDate === smartDate;
  const londonGroups  = buildLeverGroups(processedOptions, getLondonIata);
  const destGroups    = buildLeverGroups(processedOptions, getDestIata);
  const showDestTable = new Set(processedOptions.map(getDestIata)).size >= 2;

  const table1Title = direction === 'outbound'
    ? 'Cheapest from each London airport'
    : 'Cheapest into each London airport';
  const table2Title = direction === 'outbound'
    ? 'Cheapest into each arrival airport'
    : 'Cheapest from each departure airport';

  return (
    <div style={{
      background: '#ffffff',
      borderRadius: 16,
      boxShadow: '0 2px 12px rgba(13,92,99,0.08)',
      padding: 24,
      fontFamily: 'Inter, sans-serif',
    }}>
      {/* Header toggle */}
      <button
        onClick={() => setOpen((v: boolean) => !v)}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          width: '100%',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#004349', lineHeight: 1.3, marginBottom: 4 }}>
            {directionLabel(direction)} · {formatDate(selectedDate)}
          </div>
          {isSmartDate ? (
            <div style={{ fontSize: 13, color: '#6f797a', lineHeight: 1.4 }}>
              Best option per airport — true all-in cost including fare, bags, seats and transport.
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#6f797a', lineHeight: 1.4 }}>
              Showing options for {formatDate(selectedDate)}. Click any date in the matrix above to compare.
            </div>
          )}
        </div>
        <div style={{ marginLeft: 16, flexShrink: 0, color: '#004349', paddingTop: 2 }}>
          {open ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </div>
      </button>

      {/* Collapsible body */}
      {open && (
        <div style={{ marginTop: 20 }}>
          {processedOptions.length === 0 ? (
            <p style={{ fontSize: 14, color: '#718096', margin: 0 }}>
              No options available for this date.
            </p>
          ) : (
            <>
              {/* Table 1 — London airport lever */}
              <div style={{ fontSize: 12, fontWeight: 600, color: '#3f484a', marginBottom: 10 }}>
                {table1Title}
              </div>

              <LeverTable
                groups={londonGroups}
                getAirportIata={getLondonIata}
                getDestIata={getDestIata}
                direction={direction}
                transitPreference={transitPreference}
              />

              {/* Table 2 — Destination airport lever */}
              {showDestTable && (
                <>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    margin: '20px 0 10px',
                  }}>
                    <div style={{ flex: 1, height: 1, background: '#e8edee' }} />
                    <div style={{
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: 'uppercase' as const,
                      letterSpacing: '0.06em',
                      color: '#6f797a',
                    }}>
                      {table2Title}
                    </div>
                    <div style={{ flex: 1, height: 1, background: '#e8edee' }} />
                  </div>

                  <LeverTable
                    groups={destGroups}
                    getAirportIata={getDestIata}
                    getDestIata={getLondonIata}
                    direction={direction}
                    transitPreference={transitPreference}
                  />
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
