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
  // Raw pence values from RPC — used to compute transit_cost_gbp in TypeScript
  transit_offpeak_fare_pence: number | null;
  transit_peak_fare_pence: number | null;
  uber_low_pence: number | null;
  uber_high_pence: number | null;
  // Computed in TypeScript after receiving RPC data
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
  transitPreference: 'auto' | 'uber';
  postcodeDistrict: string | null;
  selectedDate: string;
  smartDate: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ancillaryGbp(opt: LegOption): number {
  return opt.cabin_bag_cost_gbp + opt.checked_bag_cost_gbp + opt.seat_cost_gbp;
}

// Fix 1 — match on airline + origin + destination only, no departure_time
function isRecommended(opt: LegOption, rec: RecommendedOption | null | undefined): boolean {
  if (!rec) return false;
  return (
    opt.airline_iata     === rec.airline_iata &&
    opt.origin_iata      === rec.origin_iata &&
    opt.destination_iata === rec.destination_iata
  );
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

// Keyword-first transit mode extraction
function extractTransitMode(method: string | null): string {
  if (!method) return '—';
  if (method.includes('National Express')) return 'National Express';
  if (method.includes('Stansted Express')) return 'Stansted Express';
  if (method.includes('Thameslink'))       return 'Thameslink';
  if (method.includes('Gatwick Express'))  return 'Gatwick Express';
  if (method.includes('DLR'))              return 'DLR';
  if (method.includes('Bus'))              return 'Bus';
  if (method.includes('Uber'))             return 'Uber';
  return method.split('→')[0].trim().slice(0, 20);
}

// ── Transit cost computation ──────────────────────────────────────────────────
// Mirrors the 4-rule logic in transitCost.ts, simplified for count-based children.

function computeTransitCost(
  option: LegOption,
  adults: number,
  children: number,
  transitPreference: 'auto' | 'uber',
  isEarlyMorning: boolean,
  direction: 'outbound' | 'return',
): number {
  const totalPax     = adults + children;
  const xlMultiplier = totalPax >= 4 ? 1.5 : 1.0;

  const uberMid = option.uber_low_pence != null && option.uber_high_pence != null
    ? (option.uber_low_pence + option.uber_high_pence) / 200.0
    : null;
  const uberCost = uberMid != null ? uberMid * xlMultiplier : null;

  // Always-Uber preference
  if (transitPreference === 'uber') {
    return uberCost ?? 0;
  }

  const transitFare = option.transit_offpeak_fare_pence != null
    ? option.transit_offpeak_fare_pence / 100.0
    : null;

  // Rule 1: Early morning → Uber (high estimate) — outbound only
  if (isEarlyMorning) {
    const uberHigh = option.uber_high_pence != null
      ? (option.uber_high_pence / 100.0) * xlMultiplier
      : null;
    return uberHigh ?? transitFare ?? 0;
  }

  // Rule 2: No transit fare → Uber
  if (transitFare === null) {
    return uberCost ?? 0;
  }

  // Rule 3: ≥2 changes AND Uber within £50 of transit → Uber (less hassle)
  if (
    (option.transit_changes ?? 0) >= 2 &&
    uberCost != null &&
    Math.abs(uberCost - transitFare) <= 50
  ) {
    return uberCost;
  }

  // Rule 4: Default → transit with child fare adjustment
  const londonAirport = direction === 'outbound' ? option.origin_iata : option.destination_iata;
  const adultFarePerPerson = adults > 0 ? transitFare / adults : transitFare;
  const method = option.transit_method ?? '';

  let childFare = 0;
  if (londonAirport === 'LHR' || londonAirport === 'LCY') {
    childFare = children * 1.05;
  } else if (londonAirport === 'LTN' || method.includes('National Express')) {
    childFare = children * adultFarePerPerson * 0.75;
  } else {
    childFare = children * adultFarePerPerson * 0.5;
  }

  return adults * adultFarePerPerson + childFare;
}

// ── Airport badge ─────────────────────────────────────────────────────────────

function AirportBadge({ iata, isCheapest }: { iata: string; isCheapest: boolean }) {
  return (
    <div style={{
      padding: '4px 8px',
      borderRadius: 6,
      background: isCheapest ? '#004349' : '#e1e3e3',
      color: isCheapest ? '#ffffff' : '#3f484a',
      fontSize: 12,
      fontWeight: 700,
      textAlign: 'center' as const,
      letterSpacing: '0.03em',
      display: 'inline-block',
    }}>
      {iata}
    </div>
  );
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

// ── Lever row ─────────────────────────────────────────────────────────────────

function LeverRow({
  opt,
  airportIata,
  destCityIata,
  isCheapestRow,
  isRec,
  notCheapestNote,
  isFirst,
  transitPreference,
  isSmartDate,
}: {
  opt: LegOption;
  airportIata: string;
  destCityIata: string;
  isCheapestRow: boolean;
  isRec: boolean;
  notCheapestNote: boolean;
  isFirst: boolean;
  transitPreference: 'auto' | 'uber';
  isSmartDate: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showTooltip, setTooltip] = useState(false);
  const anc  = ancillaryGbp(opt);
  const cost = opt.transit_cost_gbp ?? 0;

  const showOurPick  = isSmartDate && isRec;
  const showCheapest = !isSmartDate && isCheapestRow;
  const bg           = isCheapestRow ? '#f0f8f9' : undefined;
  const toggle       = () => setExpanded((v: boolean) => !v);

  const tdStyle = {
    backgroundColor: bg,
    cursor: 'pointer' as const,
    paddingTop: 10,
    paddingBottom: 10,
    verticalAlign: 'middle' as const,
  };

  return (
    <>
      {/* Separator row */}
      {!isFirst && (
        <tr>
          <td colSpan={7} style={{ borderBottom: '1px solid #e8edee', padding: 0, height: 1 }} />
        </tr>
      )}

      {/* OUR PICK / CHEAPEST marker row */}
      {(showOurPick || showCheapest) && (
        <tr>
          <td colSpan={7} style={{
            backgroundColor: bg,
            fontSize: 9, fontWeight: 700, color: '#004349',
            letterSpacing: '0.05em', textTransform: 'uppercase' as const,
            paddingTop: 8, paddingBottom: 2,
          }}>
            {showOurPick ? '★ Our pick' : '★ Cheapest'}
            {showOurPick && notCheapestNote && (
              <span style={{
                fontSize: 9, fontWeight: 400, color: '#6f797a',
                fontStyle: 'italic', marginLeft: 8,
                textTransform: 'none' as const,
              }}>
                Not cheapest for this airport — chosen for overall trip cost.
              </span>
            )}
          </td>
        </tr>
      )}

      {/* Data row */}
      <tr onClick={toggle} style={{ cursor: 'pointer' }}>
        {/* Col 1: Airport badge */}
        <td style={{
          ...tdStyle,
          borderLeft: isCheapestRow ? '3px solid #004349' : '3px solid transparent',
          paddingRight: 8,
        }}>
          <div style={{
            width: 36, height: 36,
            borderRadius: 6,
            background: isCheapestRow ? '#004349' : '#e1e3e3',
            color: isCheapestRow ? '#ffffff' : '#3f484a',
            fontSize: 11, fontWeight: 700, letterSpacing: '0.03em',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {airportIata}
          </div>
        </td>

        {/* Col 2: Airline + Route */}
        <td style={{ ...tdStyle, paddingRight: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1a2526', lineHeight: 1.3 }}>
            {opt.airline_name}
          </div>
          <div style={{ fontSize: 10, color: '#6f797a', lineHeight: 1.4 }}>
            {opt.origin_iata} → {opt.destination_iata} · {fmt(opt.departure_time)}–{fmt(opt.arrival_time)}
          </div>
        </td>

        {/* Col 3: Fare */}
        <td style={{ ...tdStyle, textAlign: 'right' as const }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a2526' }}>
            {gbp(opt.fare_gbp)}
          </div>
        </td>

        {/* Col 4: Bags+Seats */}
        <td style={{ ...tdStyle, textAlign: 'right' as const }}>
          <div
            style={{ position: 'relative', display: 'inline-block' }}
            onMouseEnter={() => setTooltip(true)}
            onMouseLeave={() => setTooltip(false)}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1a2526' }}>{gbp(anc)}</div>
            {showTooltip && <AncillaryTooltip opt={opt} />}
          </div>
        </td>

        {/* Col 5: Transport */}
        <td style={{ ...tdStyle, paddingLeft: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a2526' }}>{gbp(cost)}</div>
          <div style={{ fontSize: 10, color: '#3f484a' }}>
            {transitPreference === 'uber' ? 'Uber (estimated)' : extractTransitMode(opt.transit_method)}
          </div>
        </td>

        {/* Col 6: Dest. Transfer */}
        <td style={{ ...tdStyle, textAlign: 'right' as const }}>
          {opt.destination_transfer_gbp > 0 ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1a2526' }}>
                {gbp(opt.destination_transfer_gbp)}
              </div>
              <div style={{ fontSize: 10, color: '#3f484a' }}>{destCityIata} airport</div>
            </>
          ) : (
            <span style={{ fontSize: 12, color: '#6f797a' }}>—</span>
          )}
        </td>

        {/* Col 7: Total */}
        <td style={{
          ...tdStyle,
          textAlign: 'right' as const,
          fontSize: 15, fontWeight: 700,
          color: isCheapestRow ? '#004349' : '#191c1d',
        }}>
          {gbp(opt.total_gbp)}
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
  airportIata:      string;
  displayRow:       ProcessedOption;
  isRec:            boolean;
  notCheapestNote:  boolean;
}

function buildLeverGroups(
  opts:       ProcessedOption[],
  getAirport: (o: ProcessedOption) => string,
  recOption:  ProcessedOption | null,
): LeverGroup[] {
  const groupMap = new Map<string, ProcessedOption[]>();
  for (const opt of opts) {
    const ap = getAirport(opt);
    if (!groupMap.has(ap)) groupMap.set(ap, []);
    groupMap.get(ap)!.push(opt);
  }

  const groups: LeverGroup[] = [];
  for (const [airportIata, members] of groupMap) {
    const sorted = [...members].sort((a, b) => a.total_gbp - b.total_gbp);
    const cheapest = sorted[0];
    const recInGroup = recOption && members.some(
      o => o.airline_iata === recOption.airline_iata &&
           o.origin_iata  === recOption.origin_iata  &&
           o.destination_iata === recOption.destination_iata,
    ) ? recOption : null;

    if (recInGroup) {
      groups.push({
        airportIata,
        displayRow:      recInGroup,
        isRec:           true,
        notCheapestNote: recInGroup.total_gbp > cheapest.total_gbp,
      });
    } else {
      groups.push({
        airportIata,
        displayRow: cheapest,
        isRec:      false,
        notCheapestNote: false,
      });
    }
  }

  groups.sort((a, b) => a.displayRow.total_gbp - b.displayRow.total_gbp);
  return groups;
}

// ── Main component ────────────────────────────────────────────────────────────

export function LegOptions({
  data,
  title,
  recommendedOption,
  adults,
  children,
  transitPreference,
  selectedDate,
  smartDate,
}: LegOptionsProps) {
  const [open, setOpen] = useState(false);

  const direction = data?.direction ?? 'outbound';

  // Apply party-size-aware transit cost computation and re-sort
  const processedOptions: ProcessedOption[] = (data?.options ?? []).map((opt) => {
    const isEarlyMorning =
      direction === 'outbound' && fmt(opt.departure_time) < '07:00';
    const transitCost = computeTransitCost(
      opt, adults, children, transitPreference, isEarlyMorning, direction,
    );
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

  const recOption = processedOptions.find(o => isRecommended(o, recommendedOption)) ?? null;

  const londonGroups = buildLeverGroups(processedOptions, getLondonIata, recOption);
  const destGroups   = buildLeverGroups(processedOptions, getDestIata,   recOption);
  const showDestTable = new Set(processedOptions.map(getDestIata)).size >= 2;

  const table1Title = direction === 'outbound'
    ? 'Does your departure airport matter?'
    : 'Does your arrival airport matter?';
  const table2Title = direction === 'outbound'
    ? 'Does the arrival airport matter?'
    : 'Does the departure airport matter?';

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
          textAlign: 'left' as const,
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#004349', lineHeight: 1.3, marginBottom: 4 }}>
            {directionLabel(direction)} · {formatDate(selectedDate)}
          </div>
          {selectedDate === smartDate ? (
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
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                tableLayout: 'fixed',
                border: '1px solid #e8edee',
                borderRadius: 10,
                overflow: 'hidden',
              }}>
                <colgroup>
                  <col style={{ width: 44 }} />
                  <col />
                  <col style={{ width: 60 }} />
                  <col style={{ width: 70 }} />
                  <col style={{ width: 110 }} />
                  <col style={{ width: 75 }} />
                  <col style={{ width: 65 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={{ padding: '0 8px 8px 4px', borderBottom: '1px solid #bfc8c9' }} />
                    <th style={{ padding: '0 12px 8px 0', borderBottom: '1px solid #bfc8c9' }} />
                    {(['Fare', 'Bags', 'Transport', 'Dest.', 'Total'] as const).map((h, i) => (
                      <th key={h} style={{
                        fontSize: 9, fontWeight: 600, color: '#6f797a',
                        letterSpacing: '0.05em', textTransform: 'uppercase',
                        paddingBottom: 8, borderBottom: '1px solid #bfc8c9',
                        textAlign: i === 2 ? 'left' : 'right',
                        paddingLeft: i === 2 ? 8 : 0,
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {londonGroups.map((group, i) => (
                    <LeverRow
                      key={`london-${group.airportIata}`}
                      opt={group.displayRow}
                      airportIata={getLondonIata(group.displayRow)}
                      destCityIata={getDestIata(group.displayRow)}
                      isCheapestRow={i === 0}
                      isRec={group.isRec}
                      notCheapestNote={group.notCheapestNote}
                      isFirst={i === 0}
                      transitPreference={transitPreference}
                      isSmartDate={selectedDate === smartDate}
                    />
                  ))}
                </tbody>
              </table>

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
                  <table style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    tableLayout: 'fixed',
                    border: '1px solid #e8edee',
                    borderRadius: 10,
                    overflow: 'hidden',
                  }}>
                    <colgroup>
                      <col style={{ width: 44 }} />
                      <col />
                      <col style={{ width: 60 }} />
                      <col style={{ width: 70 }} />
                      <col style={{ width: 110 }} />
                      <col style={{ width: 75 }} />
                      <col style={{ width: 65 }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th style={{ padding: '0 8px 8px 4px', borderBottom: '1px solid #bfc8c9' }} />
                        <th style={{ padding: '0 12px 8px 0', borderBottom: '1px solid #bfc8c9' }} />
                        {(['Fare', 'Bags', 'Transport', 'Dest.', 'Total'] as const).map((h, i) => (
                          <th key={h} style={{
                            fontSize: 9, fontWeight: 600, color: '#6f797a',
                            letterSpacing: '0.05em', textTransform: 'uppercase',
                            paddingBottom: 8, borderBottom: '1px solid #bfc8c9',
                            textAlign: i === 2 ? 'left' : 'right',
                            paddingLeft: i === 2 ? 8 : 0,
                          }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {destGroups.map((group, i) => (
                        <LeverRow
                          key={`dest-${group.airportIata}`}
                          opt={group.displayRow}
                          airportIata={getDestIata(group.displayRow)}
                          destCityIata={getDestIata(group.displayRow)}
                          isCheapestRow={i === 0}
                          isRec={group.isRec}
                          notCheapestNote={group.notCheapestNote}
                          isFirst={i === 0}
                          transitPreference={transitPreference}
                          isSmartDate={selectedDate === smartDate}
                        />
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
