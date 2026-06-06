'use client'

import { useState, useMemo } from 'react'

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
}

// ── Constants ─────────────────────────────────────────────────────────────────

const AIRLINE_NAMES: Record<string, string> = {
  FR: 'Ryanair',
  U2: 'easyJet',
  W6: 'Wizz Air',
  VY: 'Vueling',
  TP: 'TAP Air Portugal',
  BA: 'British Airways',
}

const CABIN_INCLUDED_CARRIERS = new Set(['BA', 'TP'])
const CABIN_BUNDLE_ONLY_CARRIERS = new Set(['FR'])

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

function cabinBagLegCost(
  carrier: string,
  cabinFee: number | null,
  bundleDelta: number | null,
  bundleInclChecked: boolean | null,
): number {
  if (CABIN_INCLUDED_CARRIERS.has(carrier)) return 0
  if (
    CABIN_BUNDLE_ONLY_CARRIERS.has(carrier) &&
    bundleInclChecked === false &&
    bundleDelta !== null
  ) {
    return Math.min(cabinFee ?? Infinity, bundleDelta)
  }
  return cabinFee ?? 0
}

function deriveBagCost(row: CarrierRow, pCabinBags: number, pCheckedBags: number): number {
  // If RPC pre-computed baggage_cost, prefer it
  if (row.baggage_cost !== null) return row.baggage_cost

  let cost = 0

  // Cabin bags
  if (pCabinBags > 0) {
    const outCabin = cabinBagLegCost(
      row.outbound_carrier,
      row.outbound_cabin_bag_fee_gbp,
      row.bundle_price_delta_gbp,
      row.bundle_includes_checked,
    ) * pCabinBags

    const retCabin = cabinBagLegCost(
      row.return_carrier,
      row.return_cabin_bag_fee_gbp,
      row.return_bundle_price_delta_gbp,
      row.return_bundle_includes_checked,
    ) * pCabinBags

    cost += outCabin + retCabin
  }

  // Checked bags (one bag shared — fee per leg, not × party)
  if (pCheckedBags > 0) {
    cost += (row.outbound_bag_fee_pp ?? 0) + (row.return_bag_fee_pp ?? 0)
  }

  return cost
}

function trueTotalGbp(row: CarrierRow, bagCost: number): number {
  return row.base_fare_total + bagCost + (row.seat_cost ?? 0)
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AllInCost({
  data,
  partySize,
  pCabinBags,
  pCheckedBags,
  seatsTogether,
  smartOutboundDate,
  smartReturnDate,
}: AllInCostProps) {
  const [open, setOpen]           = useState(false)
  const [showAll, setShowAll]     = useState(false)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const enriched = useMemo(() => {
    if (!data?.carriers) return []
    return data.carriers
      .map((r) => {
        const bagCost   = deriveBagCost(r, pCabinBags, pCheckedBags)
        const trueTotal = trueTotalGbp(r, bagCost)
        return { ...r, bagCost, trueTotal }
      })
      .sort((a, b) => a.trueTotal - b.trueTotal)
  }, [data, pCabinBags, pCheckedBags])

  if (!data || enriched.length === 0) return null

  const cheapestTotal = enriched[0].trueTotal
  const visibleCarriers = showAll ? enriched : enriched.slice(0, 5)
  const hiddenCount = enriched.length - 5

  const subLabel = `Base fare + bags + seats for ${fmtDate(smartOutboundDate)} → ${fmtDate(smartReturnDate)}, party of ${partySize}`

  return (
    <div
      className="bg-white rounded-lg font-inter"
      style={{ boxShadow: '0 2px 12px rgba(13,92,99,0.08)', padding: 24 }}
    >
      {/* Toggle button */}
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
        </div>
      </button>

      {/* Expanded content */}
      {open && (
        <div style={{ marginTop: 24 }}>
          {visibleCarriers.map((row) => {
            const key       = `${row.outbound_carrier}-${row.return_carrier}`
            const isExp     = expandedKey === key
            const name      = AIRLINE_NAMES[row.outbound_carrier] ?? row.outbound_carrier
            const isCheapest = row.trueTotal === cheapestTotal

            const { bagCost, trueTotal } = row
            const seatCost  = row.seat_cost ?? 0
            const headlinePP = Math.round(row.base_fare_total / partySize)

            // Stacked bar proportions
            const barTotal = row.base_fare_total + bagCost + seatCost
            const basePct  = barTotal > 0 ? (row.base_fare_total / barTotal) * 100 : 100
            const bagPct   = barTotal > 0 ? (bagCost / barTotal) * 100 : 0
            const seatPct  = barTotal > 0 ? (seatCost / barTotal) * 100 : 0

            const cabinIncluded =
              CABIN_INCLUDED_CARRIERS.has(row.outbound_carrier) ||
              CABIN_INCLUDED_CARRIERS.has(row.return_carrier)

            return (
              <div
                key={key}
                style={{
                  background: '#ffffff',
                  borderRadius: 12,
                  border: '1px solid #bfc8c9',
                  padding: 16,
                  marginBottom: 12,
                }}
              >
                {/* Row 1 — header */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: 14,
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#191c1d' }}>{name}</div>
                    <div style={{ fontSize: 12, color: '#6f797a', marginTop: 2 }}>
                      {row.outbound_airport} → {row.return_carrier !== row.outbound_carrier ? row.return_carrier : row.outbound_airport}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 0 }}>
                    {isCheapest && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '3px 9px',
                          background: '#004349',
                          color: '#ffffff',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 600,
                          fontFamily: 'Inter, sans-serif',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        ★ Cheapest all-in
                      </span>
                    )}
                    {row.family_split_risk && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '3px 9px',
                          background: '#fffbeb',
                          color: '#92400e',
                          border: '1px solid #fdba49',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 600,
                          fontFamily: 'Inter, sans-serif',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Family split risk
                      </span>
                    )}
                  </div>
                </div>

                {/* Row 2 — stacked bar */}
                <div
                  style={{
                    display: 'flex',
                    height: 8,
                    borderRadius: 999,
                    overflow: 'hidden',
                    background: '#eceeee',
                    marginBottom: 8,
                  }}
                >
                  <div style={{ width: `${basePct}%`, background: '#004349' }} />
                  {bagCost > 0 && (
                    <div style={{ width: `${bagPct}%`, background: '#fdba49' }} />
                  )}
                  {seatCost > 0 && (
                    <div style={{ width: `${seatPct}%`, background: '#fdd98a' }} />
                  )}
                </div>

                {/* Bar legend */}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, color: '#6f797a', marginBottom: 14 }}>
                  <LegendDot color="#004349" label={`Base fares (×${partySize}): ${gbp(row.base_fare_total)}`} />
                  {bagCost > 0 ? (
                    <LegendDot color="#fdba49" label={`Bags: ${gbp(bagCost)}`} />
                  ) : cabinIncluded ? (
                    <span style={{ color: '#6f797a' }}>Bags included in fare</span>
                  ) : (
                    <span style={{ color: '#6f797a' }}>No bags added</span>
                  )}
                  {seatCost > 0 ? (
                    <LegendDot color="#fdd98a" label={`Seats: ${gbp(seatCost)}`} />
                  ) : !seatsTogether ? (
                    <span style={{ color: '#6f797a' }}>No seat selection</span>
                  ) : null}
                </div>

                {/* Row 3 — summary */}
                <div style={{ fontSize: 13, color: '#191c1d', marginBottom: 12 }}>
                  <span style={{ color: '#6f797a' }}>Headline:</span>{' '}
                  <strong>£{headlinePP}pp</strong>
                  <span style={{ color: '#bfc8c9', margin: '0 8px' }}>·</span>
                  <span style={{ color: '#6f797a' }}>True total:</span>{' '}
                  <strong style={{ color: '#004349' }}>{gbp(trueTotal)}</strong>
                </div>

                {/* Row 4 — expandable breakdown */}
                <button
                  onClick={() => setExpandedKey(isExp ? null : key)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#004349',
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: 'pointer',
                    padding: 0,
                    fontFamily: 'Inter, sans-serif',
                    textDecoration: 'underline',
                    textUnderlineOffset: 3,
                  }}
                >
                  {isExp ? 'Hide breakdown' : 'Show full breakdown'}
                </button>

                {isExp && (
                  <div style={{ marginTop: 14 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'Inter, sans-serif' }}>
                      <tbody>
                        <tr style={{ borderBottom: '1px solid #e1e3e3' }}>
                          <td style={{ padding: '8px 0', color: '#3f484a' }}>Base fare outbound</td>
                          <td style={{ padding: '8px 0', textAlign: 'right', color: '#191c1d' }}>{gbp(row.outbound_fare)}</td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #e1e3e3' }}>
                          <td style={{ padding: '8px 0', color: '#3f484a' }}>Base fare return</td>
                          <td style={{ padding: '8px 0', textAlign: 'right', color: '#191c1d' }}>{gbp(row.return_fare)}</td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #e1e3e3' }}>
                          <td style={{ padding: '8px 0', color: '#3f484a' }}>
                            Cabin bags
                            {pCabinBags > 0 && <span style={{ color: '#9ba8a9', marginLeft: 4 }}>×{pCabinBags}</span>}
                          </td>
                          <td style={{ padding: '8px 0', textAlign: 'right', color: '#191c1d' }}>
                            {pCabinBags === 0 ? <span style={{ color: '#9ba8a9' }}>—</span>
                              : cabinIncluded ? <span style={{ color: '#6f797a' }}>Included</span>
                              : gbp(cabinBagLegCost(row.outbound_carrier, row.outbound_cabin_bag_fee_gbp, row.bundle_price_delta_gbp, row.bundle_includes_checked) * pCabinBags
                                  + cabinBagLegCost(row.return_carrier, row.return_cabin_bag_fee_gbp, row.return_bundle_price_delta_gbp, row.return_bundle_includes_checked) * pCabinBags)}
                          </td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #e1e3e3' }}>
                          <td style={{ padding: '8px 0', color: '#3f484a' }}>
                            Checked bags
                            {pCheckedBags > 0 && <span style={{ color: '#9ba8a9', marginLeft: 4 }}>×{pCheckedBags}</span>}
                          </td>
                          <td style={{ padding: '8px 0', textAlign: 'right', color: '#191c1d' }}>
                            {pCheckedBags === 0 ? <span style={{ color: '#9ba8a9' }}>—</span>
                              : gbp((row.outbound_bag_fee_pp ?? 0) + (row.return_bag_fee_pp ?? 0))}
                          </td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #e1e3e3' }}>
                          <td style={{ padding: '8px 0', color: '#3f484a' }}>Seats</td>
                          <td style={{ padding: '8px 0', textAlign: 'right', color: '#191c1d' }}>
                            {seatCost > 0 ? gbp(seatCost) : <span style={{ color: '#9ba8a9' }}>—</span>}
                          </td>
                        </tr>
                        <tr>
                          <td style={{ padding: '12px 0 0', fontWeight: 700, color: '#191c1d' }}>Total</td>
                          <td style={{ padding: '12px 0 0', textAlign: 'right', fontWeight: 700, color: '#004349' }}>
                            {gbp(trueTotal)}
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    {row.family_split_risk && (
                      <p style={{ marginTop: 12, fontSize: 11, color: '#805600', lineHeight: 1.5 }}>
                        ⚠ {name} uses algorithmic seating — family members may be split without seat selection.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* Show all link */}
          {!showAll && hiddenCount > 0 && (
            <button
              onClick={() => setShowAll(true)}
              style={{
                background: 'none',
                border: 'none',
                color: '#004349',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                padding: '4px 0',
                fontFamily: 'Inter, sans-serif',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
              }}
            >
              Show all {enriched.length} airlines
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Sub-component ─────────────────────────────────────────────────────────────

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: 2,
          background: color,
          flexShrink: 0,
        }}
      />
      {label}
    </span>
  )
}
