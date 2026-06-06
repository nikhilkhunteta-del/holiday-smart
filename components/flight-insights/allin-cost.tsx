'use client'

import { useState, useMemo, useRef } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CarrierRow {
  outbound_carrier: string
  return_carrier: string
  split_carrier: boolean
  outbound_airport: string
  outbound_fare: number
  return_fare: number
  base_fare_total: number
  party_size: number
  baggage_cost: number | null
  outbound_bag_fee_pp: number | null
  return_bag_fee_pp: number | null
  outbound_cabin_bag_fee_gbp: number | null
  return_cabin_bag_fee_gbp: number | null
  outbound_cabin_bag_included: boolean | null
  return_cabin_bag_included: boolean | null
  outbound_cabin_bag_max_kg: number | null
  bundle_name: string | null
  bundle_price_delta_gbp: number | null
  bundle_includes_checked: boolean | null
  return_bundle_name: string | null
  return_bundle_price_delta_gbp: number | null
  return_bundle_includes_checked: boolean | null
  seat_cost: number | null
  outbound_seat_fee_pp: number | null
  return_seat_fee_pp: number | null
  transfer_mode: string
  transfer_cost_known: boolean
  transfer_cost: number | null
  public_transfer_gbp: number | null
  allin_total: number | null
  allin_is_complete: boolean
  baggage_is_estimate: boolean
  family_split_risk: boolean
  split_risk_carriers: string[]
  is_recommended: boolean
}

interface AllinData {
  outbound_date: string
  return_date: string
  party_size: number
  transport_mode: string
  carriers: CarrierRow[]
}

export interface AllInCostProps {
  data: AllinData | null
  partySize: number
  pCabinBags: number
  pCheckedBags: number
  seatsTogether: boolean
  smartOutboundDate: string | undefined
  smartReturnDate: string | undefined
  destinationAirport?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PHASE1_CARRIERS = ['BA', 'U2', 'W6', 'VY', 'FR']

const CARRIER_NAMES: Record<string, string> = {
  BA: 'British Airways',
  U2: 'easyJet',
  W6: 'Wizz Air',
  VY: 'Vueling',
  FR: 'Ryanair',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function gbp(n: number) {
  return `£${Math.round(Math.abs(n)).toLocaleString('en-GB')}`
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d.getDate()} ${months[d.getMonth()]}`
}

interface EnrichedRow extends CarrierRow {
  cabinCost: number
  checkedCost: number
  bagCost: number
  seatCost: number
  trueTotal: number
}

function deriveEnriched(row: CarrierRow, pCabinBags: number, pCheckedBags: number): EnrichedRow {
  const cabinCost =
    (row.outbound_cabin_bag_included ? 0 : (row.outbound_cabin_bag_fee_gbp ?? 0)) +
    (row.return_cabin_bag_included   ? 0 : (row.return_cabin_bag_fee_gbp   ?? 0))

  const checkedCost =
    ((row.outbound_bag_fee_pp ?? 0) * pCheckedBags) +
    ((row.return_bag_fee_pp   ?? 0) * pCheckedBags)

  const bagCost   = cabinCost + checkedCost
  const seatCost  = row.seat_cost ?? 0
  const trueTotal = row.base_fare_total + bagCost + seatCost

  return { ...row, cabinCost, checkedCost, bagCost, seatCost, trueTotal }
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function Tooltip({ row }: { row: EnrichedRow }) {
  const name       = CARRIER_NAMES[row.outbound_carrier] ?? row.outbound_carrier
  const returnName = CARRIER_NAMES[row.return_carrier]   ?? row.return_carrier
  const isSplit    = row.outbound_carrier !== row.return_carrier

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 8px)',
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#2e3131',
        color: '#eff1f1',
        borderRadius: 8,
        padding: 12,
        maxWidth: 240,
        width: 'max-content',
        fontSize: 12,
        fontFamily: 'Inter, sans-serif',
        lineHeight: 1.5,
        zIndex: 10,
        pointerEvents: 'none',
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: isSplit ? 2 : 8 }}>{name}</div>
      {isSplit && (
        <div style={{ color: '#bfc8c9', marginBottom: 8, fontSize: 11 }}>
          Return: {returnName}
        </div>
      )}
      <div style={{ borderTop: '1px solid #3f484a', marginBottom: 8 }} />
      <TooltipRow label="Base fare outbound" value={gbp(row.outbound_fare)} />
      <TooltipRow label="Base fare return"   value={gbp(row.return_fare)} />
      <TooltipRow
        label="Cabin bags"
        value={row.cabinCost > 0 ? gbp(row.cabinCost) : 'Included'}
      />
      <TooltipRow
        label="Checked bags"
        value={row.checkedCost > 0 ? gbp(row.checkedCost) : 'None'}
      />
      <TooltipRow
        label="Seats"
        value={row.seatCost > 0 ? gbp(row.seatCost) : 'Not selected'}
      />
      <div style={{ borderTop: '1px solid #3f484a', margin: '8px 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
        <span>Total</span>
        <span>{gbp(row.trueTotal)}</span>
      </div>
    </div>
  )
}

function TooltipRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: '#bfc8c9' }}>{label}</span>
      <span>{value}</span>
    </div>
  )
}

// ── Chart row ─────────────────────────────────────────────────────────────────

function ChartRow({
  row,
  maxTotal,
  isCheapest,
  destinationAirport,
}: {
  row: EnrichedRow
  maxTotal: number
  isCheapest: boolean
  destinationAirport: string | undefined
}) {
  const [showTip, setShowTip] = useState(false)
  const tapRef = useRef(false)

  const name       = CARRIER_NAMES[row.outbound_carrier] ?? row.outbound_carrier
  const returnName = CARRIER_NAMES[row.return_carrier]   ?? row.return_carrier
  const isSplit    = row.outbound_carrier !== row.return_carrier

  // Route detail: "↑ STN → BCN · ↓ BCN → STN" or "↑ LHR → BCN · ↓ BCN → STN (Ryanair)"
  const routeDetail = destinationAirport
    ? `↑ ${row.outbound_airport} → ${destinationAirport} · ↓ ${destinationAirport} → ${row.outbound_airport}${isSplit ? ` (${returnName})` : ''}`
    : `↑ ${row.outbound_airport}${isSplit ? ` · return: ${returnName}` : ''}`

  // Bar width: max carrier gets 85%, others scaled proportionally, min 20%
  const MAX_PCT = 85
  const MIN_PCT = 20
  const rawPct  = maxTotal > 0 ? (row.trueTotal / maxTotal) * MAX_PCT : MAX_PCT
  const barPct  = Math.max(MIN_PCT, rawPct)

  // Stacked bar segment widths (proportional within the bar)
  const total   = row.trueTotal
  const basePct = total > 0 ? (row.base_fare_total / total) * 100 : 100
  const cabPct  = total > 0 ? (row.cabinCost   / total) * 100 : 0
  const chkPct  = total > 0 ? (row.checkedCost / total) * 100 : 0
  const seatPct = total > 0 ? (row.seatCost    / total) * 100 : 0

  function handleMouseEnter() { setShowTip(true) }
  function handleMouseLeave() { setShowTip(false) }
  function handleTap() {
    if (tapRef.current) {
      setShowTip(false)
      tapRef.current = false
    } else {
      setShowTip(true)
      tapRef.current = true
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
      {/* Label column */}
      <div style={{ width: 160, flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#191c1d', lineHeight: 1.3 }}>
          {name}
        </div>
        <div style={{ fontSize: 11, color: '#3f484a', marginTop: 2, lineHeight: 1.4, display: 'block' }}>
          {routeDetail}
        </div>
      </div>

      {/* Bar + total */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {isCheapest && (
          <div
            style={{
              fontSize: 10,
              fontFamily: 'Inter, sans-serif',
              fontWeight: 600,
              color: '#004349',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 4,
            }}
          >
            ★ Cheapest
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Bar wrapper */}
          <div
            style={{ flex: 1, position: 'relative' }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onClick={handleTap}
          >
            <div
              style={{
                width: `${barPct}%`,
                display: 'flex',
                height: 32,
                borderRadius: 999,
                overflow: 'hidden',
                cursor: 'pointer',
              }}
            >
              <div style={{ width: `${basePct}%`, background: '#004349' }} />
              {cabPct > 0 && (
                <div style={{ width: `${cabPct}%`, background: '#4A6FA5' }} />
              )}
              {chkPct > 0 && (
                <div style={{ width: `${chkPct}%`, background: '#E07B54' }} />
              )}
              {seatPct > 0 && (
                <div style={{ width: `${seatPct}%`, background: '#fdba49' }} />
              )}
            </div>

            {showTip && <Tooltip row={row} />}
          </div>

          {/* Total label */}
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: '#191c1d',
              fontFamily: 'Inter, sans-serif',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {gbp(row.trueTotal)}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Legend ────────────────────────────────────────────────────────────────────

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span
        style={{
          display: 'inline-block',
          width: 10,
          height: 10,
          borderRadius: 2,
          background: color,
          flexShrink: 0,
        }}
      />
      <span>{label}</span>
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function AllInCost({
  data,
  partySize,
  pCabinBags,
  pCheckedBags,
  smartOutboundDate,
  smartReturnDate,
  destinationAirport,
}: AllInCostProps) {
  const [open, setOpen] = useState(false)

  const chartRows = useMemo<EnrichedRow[]>(() => {
    if (!data?.carriers) return []

    const result: EnrichedRow[] = []
    for (const iata of PHASE1_CARRIERS) {
      const matching = data.carriers.filter((r) => r.outbound_carrier === iata)
      if (matching.length === 0) continue

      const enriched = matching.map((r) => deriveEnriched(r, pCabinBags, pCheckedBags))
      enriched.sort((a, b) => a.trueTotal - b.trueTotal)
      result.push(enriched[0])
    }

    result.sort((a, b) => a.trueTotal - b.trueTotal)
    return result
  }, [data, pCabinBags, pCheckedBags])

  if (!data || chartRows.length === 0) return null

  const maxTotal      = Math.max(...chartRows.map((r: EnrichedRow) => r.trueTotal))
  const cheapestTotal = chartRows[0].trueTotal

  const hasCabin   = chartRows.some((r: EnrichedRow) => r.cabinCost   > 0)
  const hasChecked = chartRows.some((r: EnrichedRow) => r.checkedCost > 0)
  const hasSeats   = chartRows.some((r: EnrichedRow) => r.seatCost    > 0)

  const subLabel = `Base fare + bags + seats for ${fmtDate(smartOutboundDate)} → ${fmtDate(smartReturnDate)}, party of ${partySize}`

  return (
    <div
      className="bg-white rounded-lg"
      style={{ boxShadow: '0 2px 12px rgba(13,92,99,0.08)', padding: 24, fontFamily: 'Inter, sans-serif' }}
    >
      {/* Toggle */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          fontFamily: 'Inter, sans-serif',
        }}
      >
        <span style={{ fontSize: 18, lineHeight: 1, color: '#004349', marginTop: 2, minWidth: 14 }}>
          {open ? '−' : '+'}
        </span>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#004349', lineHeight: 1.3 }}>
            Compare airlines for your dates
          </div>
          <div style={{ fontSize: 13, color: '#6f797a', marginTop: 4, lineHeight: 1.4 }}>
            {subLabel}
          </div>
          <div style={{ fontSize: 11, color: '#3f484a', marginTop: 2, lineHeight: 1.4 }}>
            Flight cost only — excludes transport to airport. See recommendation above for true all-in cost.
          </div>
        </div>
      </button>

      {/* Chart */}
      {open && (
        <div style={{ marginTop: 28 }}>
          {chartRows.map((row: EnrichedRow) => (
            <ChartRow
              key={row.outbound_carrier}
              row={row}
              maxTotal={maxTotal}
              isCheapest={row.trueTotal === cheapestTotal}
              destinationAirport={destinationAirport}
            />
          ))}

          {/* Legend */}
          <div
            style={{
              display: 'flex',
              gap: 14,
              flexWrap: 'wrap',
              fontSize: 11,
              color: '#6f797a',
              marginTop: 8,
              paddingTop: 12,
              borderTop: '1px solid #e1e3e3',
            }}
          >
            <LegendSwatch color="#004349" label="Base fare" />
            {hasCabin   && <LegendSwatch color="#4A6FA5" label="Cabin bags" />}
            {hasChecked && <LegendSwatch color="#E07B54" label="Checked bags" />}
            {hasSeats   && <LegendSwatch color="#fdba49" label="Seats" />}
          </div>
        </div>
      )}
    </div>
  )
}
