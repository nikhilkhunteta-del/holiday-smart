'use client';

import { useState, type ReactNode } from 'react';
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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ancillaryGbp(opt: LegOption): number {
  return opt.cabin_bag_cost_gbp + opt.checked_bag_cost_gbp + opt.seat_cost_gbp;
}

function isRecommended(opt: LegOption, rec: RecommendedOption | null | undefined): boolean {
  if (!rec) return false;
  return (
    opt.airline_iata     === rec.airline_iata &&
    opt.origin_iata      === rec.origin_iata &&
    opt.destination_iata === rec.destination_iata &&
    opt.departure_time.slice(0, 5) === (rec.departure_time ?? '').slice(0, 5)
  );
}

function gbp(n: number): string {
  return `£${Math.round(n).toLocaleString('en-GB')}`;
}

function fmt(time: string): string {
  return time.slice(0, 5);
}

// Fix 1 — keyword-first transit mode extraction
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

// ── Fix 6 — Mini proportion bar (4 segments) ─────────────────────────────────

function ProportionBar({ opt }: { opt: LegOption }) {
  const total = opt.total_gbp;
  if (total === 0) return null;

  const farePct     = (opt.fare_gbp / total) * 100;
  const ancPct      = (ancillaryGbp(opt) / total) * 100;
  const transitPct  = ((opt.transit_cost_gbp ?? 0) / total) * 100;
  const transferPct = (opt.destination_transfer_gbp / total) * 100;

  return (
    <div style={{ display: 'flex', width: '100%', height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 4 }}>
      <div style={{ width: `${farePct}%`,    background: '#004349' }} />
      <div style={{ width: `${ancPct}%`,     background: '#4A6FA5' }} />
      <div style={{ width: `${transitPct}%`, background: '#fdba49' }} />
      {opt.destination_transfer_gbp > 0 && (
        <div style={{ width: `${transferPct}%`, background: '#E07B54' }} />
      )}
    </div>
  );
}

// ── Expandable row detail ─────────────────────────────────────────────────────

function RowDetail({ opt }: { opt: LegOption }) {
  const rows: Array<{ label: string; value: string; bold?: boolean }> = [
    { label: 'Base fare',      value: gbp(opt.fare_gbp) },
    { label: 'Cabin bags',     value: opt.cabin_bag_cost_gbp  === 0 ? 'Included'     : gbp(opt.cabin_bag_cost_gbp) },
    { label: 'Checked bags',   value: opt.checked_bag_cost_gbp === 0 ? 'None'        : gbp(opt.checked_bag_cost_gbp) },
    { label: 'Seats',          value: opt.seat_cost_gbp        === 0 ? 'Not selected' : gbp(opt.seat_cost_gbp) },
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
                fontSize: 12,
                color: '#3f484a',
                padding: '3px 0',
                fontWeight: r.bold ? 700 : 400,
                borderTop: r.bold ? '1px solid #d4dbdc' : undefined,
                paddingTop: r.bold ? 8 : undefined,
              }}>
                {r.label}
              </td>
              <td style={{
                fontSize: 12,
                color: '#3f484a',
                padding: '3px 0',
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

// ── Column header + value stack (Fix 7 — tight spacing) ──────────────────────

function ColStack({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase' as const,
        letterSpacing: '0.06em',
        color: '#6f797a',
        marginBottom: 2,
      }}>
        {label}
      </div>
      {children}
    </div>
  );
}

// ── Table row ─────────────────────────────────────────────────────────────────

function OptionRow({
  opt,
  isCheapest,
  isRec,
  index,
}: {
  opt: LegOption;
  isCheapest: boolean;
  isRec: boolean;
  index: number;
}) {
  const [expanded, setExpanded]   = useState(false);
  const [showTooltip, setTooltip] = useState(false);

  const anc = ancillaryGbp(opt);

  return (
    <>
      {isRec && (
        <tr>
          <td colSpan={5} style={{ paddingBottom: 2 }}>
            <span style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: '#004349',
            }}>
              ★ Our pick
            </span>
          </td>
        </tr>
      )}
      <tr
        onClick={() => setExpanded((v: boolean) => !v)}
        style={{
          cursor: 'pointer',
          borderTop: index === 0 ? 'none' : '1px solid #e8edee',
          background: isRec ? '#f0f8f9' : 'transparent',
          borderLeft: isRec ? '3px solid #004349' : '3px solid transparent',
        }}
      >
        {/* Col 1 — Airline + Route */}
        <td style={{ padding: '12px 8px 12px 10px', verticalAlign: 'top', minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a2526', lineHeight: 1.3 }}>
            {opt.airline_name}
          </div>
          <div style={{ fontSize: 12, color: '#6f797a', lineHeight: 1.4 }}>
            {opt.origin_iata} → {opt.destination_iata}
          </div>
          <div style={{ fontSize: 11, color: '#6f797a', lineHeight: 1.4 }}>
            {fmt(opt.departure_time)} → {fmt(opt.arrival_time)}
          </div>
        </td>

        {/* Col 2 — Fare */}
        <td style={{ padding: '12px 8px', verticalAlign: 'top', width: 100 }}>
          <ColStack label="Fare">
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1a2526' }}>
              {gbp(opt.fare_gbp)}
            </div>
          </ColStack>
        </td>

        {/* Col 3 — Bags & Seats */}
        <td style={{ padding: '12px 8px', verticalAlign: 'top', width: 100 }}>
          <ColStack label="Bags + Seats">
            <div
              style={{ position: 'relative', display: 'inline-block' }}
              onMouseEnter={() => setTooltip(true)}
              onMouseLeave={() => setTooltip(false)}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1a2526' }}>
                {gbp(anc)}
              </div>
              {showTooltip && <AncillaryTooltip opt={opt} />}
            </div>
          </ColStack>
        </td>

        {/* Col 4 — Transport */}
        <td style={{ padding: '12px 8px', verticalAlign: 'top', width: 120 }}>
          <ColStack label="Transport">
            {opt.transit_cost_gbp != null ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1a2526' }}>
                  {gbp(opt.transit_cost_gbp)}
                </div>
                <div style={{ fontSize: 11, color: '#6f797a', lineHeight: 1.3 }}>
                  {extractTransitMode(opt.transit_method)}
                </div>
                {/* Fix 5 — high destination transfer warning */}
                {opt.destination_transfer_gbp >= 40 && (
                  <div style={{ fontSize: 10, color: '#805600', marginTop: 2 }}>
                    + {gbp(opt.destination_transfer_gbp)} dest. transfer
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 13, fontWeight: 700, color: '#6f797a' }}>—</div>
            )}
          </ColStack>
        </td>

        {/* Col 5 — Total */}
        <td style={{ padding: '12px 10px 12px 8px', verticalAlign: 'top', width: 100, textAlign: 'right' }}>
          <div style={{
            fontSize: 16,
            fontWeight: 700,
            color: isCheapest ? '#004349' : '#1a2526',
            lineHeight: 1.2,
          }}>
            {gbp(opt.total_gbp)}
          </div>
          <ProportionBar opt={opt} />
        </td>
      </tr>

      {expanded && (
        <tr style={{ background: isRec ? '#f0f8f9' : 'transparent' }}>
          <td colSpan={5} style={{ padding: '0 10px 12px' }}>
            <RowDetail opt={opt} />
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function LegOptions({ data, title, recommendedOption }: LegOptionsProps) {
  const [open, setOpen]       = useState(false);
  const [showAll, setShowAll] = useState(false);

  const options = data?.options ?? [];
  const sorted  = [...options].sort((a, b) => a.total_gbp - b.total_gbp);
  const visible = showAll ? sorted : sorted.slice(0, 8);

  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: 16,
        boxShadow: '0 2px 12px rgba(13,92,99,0.08)',
        padding: 24,
        fontFamily: 'Inter, sans-serif',
      }}
    >
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
            {title}
          </div>
          <div style={{ fontSize: 13, color: '#6f797a', lineHeight: 1.4 }}>
            All options ranked by true all-in cost — fare, bags, seats and transport included.
          </div>
        </div>
        <div style={{ marginLeft: 16, flexShrink: 0, color: '#004349', paddingTop: 2 }}>
          {open ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </div>
      </button>

      {/* Collapsible body */}
      {open && (
        <div style={{ marginTop: 20 }}>
          {options.length === 0 ? (
            <p style={{ fontSize: 14, color: '#718096', margin: 0 }}>
              No options available for this date.
            </p>
          ) : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {visible.map((opt, i) => (
                    <OptionRow
                      key={`${opt.airline_iata}-${opt.origin_iata}-${opt.departure_time}`}
                      opt={opt}
                      isCheapest={i === 0}
                      isRec={isRecommended(opt, recommendedOption)}
                      index={i}
                    />
                  ))}
                </tbody>
              </table>

              {!showAll && sorted.length > 8 && (
                <button
                  onClick={() => setShowAll(true)}
                  style={{
                    marginTop: 12,
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    fontSize: 13,
                    color: '#004349',
                    textDecoration: 'underline',
                  }}
                >
                  Show all {sorted.length} options
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
