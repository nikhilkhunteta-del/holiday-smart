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
  seat_cost: number | null
  outbound_seat_fee_pp: number | null
  return_seat_fee_pp: number | null
  // Cabin bag — new fields (full_cabin_bag_fee_gbp column added to airline_baggage_fees)
  outbound_cabin_bag_fee_gbp: number | null
  return_cabin_bag_fee_gbp: number | null
  outbound_cabin_bag_included: boolean | null
  return_cabin_bag_included: boolean | null
  outbound_cabin_bag_max_kg: number | null
  // Outbound carrier bundle
  bundle_name: string | null
  bundle_price_delta_gbp: number | null
  bundle_includes_checked: boolean | null
  // Return carrier bundle
  return_bundle_name: string | null
  return_bundle_price_delta_gbp: number | null
  return_bundle_includes_checked: boolean | null
  transfer_mode: string
  transfer_cost_known: boolean
  transfer_cost: number | null
  public_transfer_gbp: number | null
  public_transfer_desc: string | null
  public_transfer_mins: number | null
  uber_transfer_gbp: number | null
  uber_low_gbp: number | null
  uber_high_gbp: number | null
  drive_duration_mins: number | null
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

interface Props {
  data: AllinData | null
  tripType: 'circuit' | 'city'
  destinationAirport?: string
}

type Scenario = 'travel_light' | 'cabin_bags' | 'checked_bag'

// ── Constants ─────────────────────────────────────────────────────────────────

const AIRLINE_NAMES: Record<string, string> = {
  FR: 'Ryanair',
  U2: 'easyJet',
  W6: 'Wizz Air',
  VY: 'Vueling',
  TP: 'TAP Air Portugal',
  BA: 'British Airways',
}

// Carriers whose base fare already includes a proper overhead cabin bag
const CABIN_INCLUDED_CARRIERS = new Set(['BA', 'TP'])

// For these carriers the bundle is a cabin-bag-only add-on (not a bundle with checked bag).
// Compare full_cabin_bag_fee_gbp vs bundle_price_delta_gbp and use the cheaper path.
const CABIN_BUNDLE_ONLY_CARRIERS = new Set(['FR'])

// Checked hold bag weight by carrier (kg) — verified standard à la carte allowance
const CHECKED_BAG_KG: Record<string, number> = {
  FR: 20, W6: 20, VY: 20,
  U2: 23, TP: 23, BA: 23,
}

const SCENARIO_LABELS: Record<Scenario, string> = {
  travel_light: 'Travel light',
  cabin_bags:   'Cabin bags',
  checked_bag:  '1 checked bag',
}

const SCENARIO_SUBLABELS: Record<Scenario, string> = {
  travel_light: 'Personal item only',
  cabin_bags:   'Overhead bag for everyone',
  checked_bag:  'One bag in the hold',
}

const SEATING_POLICY: Record<string, { risk: boolean; text: string }> = {
  FR: {
    risk: true,
    text: 'Ryanair allocates seats randomly. Seats together not guaranteed unless you pay for selection. First adult travelling with a child gets a free seat.',
  },
  U2: {
    risk: true,
    text: 'easyJet allocates seats randomly. No family seating concession — seat fees apply even for 1 adult + 1 child.',
  },
  W6: {
    risk: true,
    text: 'Wizz Air allocates seats randomly. No family seating concession.',
  },
  VY: {
    risk: false,
    text: 'Vueling seats children next to adults as policy — no seat fee required for families.',
  },
  TP: {
    risk: false,
    text: 'TAP seats families together where possible at check-in. Paid selection optional.',
  },
  BA: {
    risk: false,
    text: 'British Airways allocates family seats together at check-in at no charge. Paid selection optional for guaranteed choice.',
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function gbp(n: number) {
  return `£${Math.round(n).toLocaleString('en-GB')}`
}

function cabinBagLegCost(
  carrier: string,
  cabinFee: number | null,
  bundleDelta: number | null,
  bundleInclChecked: boolean | null,
): number {
  if (CABIN_INCLUDED_CARRIERS.has(carrier)) return 0
  // For FR-style cabin-only bundles, pick the cheaper path
  if (
    CABIN_BUNDLE_ONLY_CARRIERS.has(carrier) &&
    bundleInclChecked === false &&
    bundleDelta !== null
  ) {
    return Math.min(cabinFee ?? Infinity, bundleDelta)
  }
  return cabinFee ?? 0
}

function computeScenarioBagCost(row: CarrierRow, scenario: Scenario): number {
  if (scenario === 'travel_light') return 0

  if (scenario === 'checked_bag') {
    // One bag shared by the family — fee per leg, not multiplied by party size
    return (row.outbound_bag_fee_pp ?? 0) + (row.return_bag_fee_pp ?? 0)
  }

  // cabin_bags: à la carte cabin bag per person per leg
  const outCost =
    cabinBagLegCost(
      row.outbound_carrier,
      row.outbound_cabin_bag_fee_gbp,
      row.bundle_price_delta_gbp,
      row.bundle_includes_checked,
    ) * row.party_size

  const retCost =
    cabinBagLegCost(
      row.return_carrier,
      row.return_cabin_bag_fee_gbp,
      row.return_bundle_price_delta_gbp,
      row.return_bundle_includes_checked,
    ) * row.party_size

  return outCost + retCost
}

function computeScenarioTotal(row: CarrierRow, scenario: Scenario): number {
  const bagCost = computeScenarioBagCost(row, scenario)
  const seatCost = row.seat_cost ?? 0
  const transferCost = row.transfer_cost ?? 0
  return row.base_fare_total + bagCost + seatCost + transferCost
}

function cabinBagIsIncluded(carrier: string): boolean {
  return CABIN_INCLUDED_CARRIERS.has(carrier)
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AllInCost({ data, tripType, destinationAirport }: Props) {
  const defaultScenario: Scenario = tripType === 'circuit' ? 'checked_bag' : 'travel_light'
  const [scenario, setScenario] = useState<Scenario>(defaultScenario)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const enrichedCarriers = useMemo(() => {
    if (!data?.carriers) return []
    const verified = data.carriers.filter((r) => !r.baggage_is_estimate)
    const withTotals = verified.map((r) => ({
      ...r,
      scenarioTotal: computeScenarioTotal(r, scenario),
      scenarioBagCost: computeScenarioBagCost(r, scenario),
    }))
    withTotals.sort((a, b) => a.scenarioTotal - b.scenarioTotal)
    const minTotal = withTotals[0]?.scenarioTotal ?? Infinity
    return withTotals.map((r) => ({
      ...r,
      isCheapestInScenario: r.scenarioTotal === minTotal,
    }))
  }, [data, scenario])

  if (!data || enrichedCarriers.length === 0) return null

  return (
    <section style={{ marginTop: 48, fontFamily: 'Inter, sans-serif' }}>
      {/* Heading */}
      <h2
        style={{
          fontFamily: 'Newsreader, serif',
          fontSize: 28,
          fontWeight: 500,
          color: '#191c1d',
          lineHeight: 1.3,
          margin: '0 0 6px',
        }}
      >
        All-in family cost
      </h2>
      <p style={{ fontSize: 15, color: '#6f797a', margin: '0 0 24px', lineHeight: 1.6 }}>
        Base fare + bags + seat selection. Choose how you travel to compare like-for-like.
      </p>

      {/* Scenario selector */}
      <div
        style={{
          display: 'inline-flex',
          borderRadius: 12,
          border: '1px solid #bfc8c9',
          overflow: 'hidden',
          marginBottom: 24,
        }}
      >
        {(['travel_light', 'cabin_bags', 'checked_bag'] as Scenario[]).map((s, i) => (
          <button
            key={s}
            onClick={() => setScenario(s)}
            style={{
              padding: '9px 18px',
              fontSize: 14,
              fontWeight: 600,
              fontFamily: 'Inter, sans-serif',
              border: 'none',
              borderLeft: i > 0 ? '1px solid #bfc8c9' : 'none',
              cursor: 'pointer',
              background: scenario === s ? '#004349' : '#ffffff',
              color: scenario === s ? '#ffffff' : '#3f484a',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <span>{SCENARIO_LABELS[s]}</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 400,
                opacity: 0.75,
                lineHeight: 1,
              }}
            >
              {SCENARIO_SUBLABELS[s]}
            </span>
          </button>
        ))}
      </div>

      {/* Carrier cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {enrichedCarriers.map((row) => {
          const key = `${row.outbound_carrier}-${row.return_carrier}`
          const isExpanded = expandedKey === key
          const airlineName = AIRLINE_NAMES[row.outbound_carrier] ?? row.outbound_carrier

          const { scenarioBagCost, scenarioTotal, isCheapestInScenario } = row
          const seatCost = row.seat_cost ?? 0
          const transferCost = row.transfer_cost ?? 0
          const headlinePP = row.base_fare_total / row.party_size

          // Stacked bar (excludes transfer — shows what you're adding on top of fare)
          const barTotal = row.base_fare_total + scenarioBagCost + seatCost
          const basePct = barTotal > 0 ? (row.base_fare_total / barTotal) * 100 : 100
          const bagPct = barTotal > 0 ? (scenarioBagCost / barTotal) * 100 : 0
          const seatPct = barTotal > 0 ? (seatCost / barTotal) * 100 : 0

          // Bag legend label varies by scenario
          const bagLegendLabel =
            scenario === 'travel_light'
              ? null
              : scenario === 'cabin_bags'
              ? 'Cabin bags'
              : 'Hold luggage (1 bag)'

          // Seating policy shown in breakdown for both legs' carriers
          const policyCarriers = Array.from(
            new Set([row.outbound_carrier, row.return_carrier])
          ).filter((c) => c in SEATING_POLICY)

          // Cabin bag tooltip for "Cabin bags" scenario
          const outCabinIncluded =
            scenario === 'cabin_bags' && cabinBagIsIncluded(row.outbound_carrier)
          const retCabinIncluded =
            scenario === 'cabin_bags' && cabinBagIsIncluded(row.return_carrier)

          // Breakdown bag row
          const checkedBagKg = CHECKED_BAG_KG[row.outbound_carrier]

          return (
            <div
              key={key}
              style={{
                background: '#ffffff',
                borderRadius: 16,
                boxShadow: '0 2px 12px rgba(13,92,99,0.08)',
                padding: 24,
              }}
            >
              {/* Card header */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: 16,
                  gap: 12,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 600,
                      color: '#191c1d',
                      marginBottom: 4,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    {airlineName}
                    {row.split_carrier && (
                      <span style={{ fontSize: 12, fontWeight: 400, color: '#6f797a' }}>
                        mixed carriers
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 14, color: '#6f797a' }}>
                    {row.outbound_airport}
                    {destinationAirport ? ` → ${destinationAirport}` : ''}
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: 6,
                    flexWrap: 'wrap',
                    justifyContent: 'flex-end',
                    flexShrink: 0,
                  }}
                >
                  {isCheapestInScenario && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '4px 10px',
                        background: '#004349',
                        color: '#ffffff',
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 600,
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
                        padding: '4px 10px',
                        background: '#fffbeb',
                        color: '#92400e',
                        border: '1px solid #fdba49',
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Family split risk
                    </span>
                  )}
                </div>
              </div>

              {/* Stacked bar */}
              <div
                style={{
                  display: 'flex',
                  height: 10,
                  borderRadius: 5,
                  overflow: 'hidden',
                  background: '#eceeee',
                  marginBottom: 10,
                }}
              >
                <div style={{ width: `${basePct}%`, background: '#004349' }} />
                {scenarioBagCost > 0 && (
                  <div style={{ width: `${bagPct}%`, background: '#fdba49' }} />
                )}
                {seatCost > 0 && (
                  <div style={{ width: `${seatPct}%`, background: '#fde68a' }} />
                )}
              </div>

              {/* Legend */}
              <div
                style={{
                  display: 'flex',
                  gap: 14,
                  flexWrap: 'wrap',
                  fontSize: 12,
                  color: '#6f797a',
                  marginBottom: 16,
                }}
              >
                <LegendDot color="#004349" label={`Base fares (×${row.party_size}): ${gbp(row.base_fare_total)}`} />
                {bagLegendLabel && (
                  <LegendDot
                    color="#fdba49"
                    label={`${bagLegendLabel}: ${scenarioBagCost > 0 ? gbp(scenarioBagCost) : '—'}`}
                  />
                )}
                {seatCost > 0 && (
                  <LegendDot color="#fde68a" label={`Seat selection: ${gbp(seatCost)}`} />
                )}
              </div>

              {/* Headline / True total */}
              <div style={{ fontSize: 15, color: '#191c1d', marginBottom: 14 }}>
                <span style={{ color: '#6f797a' }}>Headline:</span>{' '}
                <strong>{gbp(headlinePP)}pp</strong>
                <span style={{ color: '#bfc8c9', margin: '0 8px' }}>·</span>
                <span style={{ color: '#6f797a' }}>True total:</span>{' '}
                <strong style={{ color: '#004349', fontSize: 17 }}>
                  {gbp(scenarioTotal)}
                </strong>
              </div>

              {/* Expand link */}
              <button
                onClick={() => setExpandedKey(isExpanded ? null : key)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#004349',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: 0,
                  fontFamily: 'Inter, sans-serif',
                  textDecoration: 'underline',
                  textUnderlineOffset: 3,
                }}
              >
                {isExpanded ? 'Hide breakdown ▲' : 'Show full breakdown ▼'}
              </button>

              {/* Expanded breakdown */}
              {isExpanded && (
                <div style={{ marginTop: 16 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <tbody>
                      <tr style={{ borderBottom: '1px solid #e1e3e3' }}>
                        <td style={{ padding: '9px 0', color: '#3f484a' }}>Headline fare</td>
                        <td style={{ padding: '9px 0', textAlign: 'right', color: '#191c1d' }}>
                          {gbp(row.base_fare_total)}
                        </td>
                      </tr>

                      {/* Bag row — label + cost depends on scenario */}
                      <tr style={{ borderBottom: '1px solid #e1e3e3' }}>
                        <td style={{ padding: '9px 0', color: '#3f484a', verticalAlign: 'top' }}>
                          {scenario === 'travel_light' && 'Personal item'}
                          {scenario === 'cabin_bags' && (
                            <>
                              Cabin bag (×{row.party_size})
                              {(outCabinIncluded || retCabinIncluded) && (
                                <span
                                  title="Cabin bag included in base fare"
                                  style={{
                                    marginLeft: 5,
                                    cursor: 'help',
                                    color: '#6f797a',
                                    fontSize: 12,
                                  }}
                                >
                                  ⓘ
                                </span>
                              )}
                            </>
                          )}
                          {scenario === 'checked_bag' && (
                            <>
                              Hold luggage (1 bag)
                              {checkedBagKg && (
                                <span style={{ display: 'block', fontSize: 12, color: '#6f797a', marginTop: 2 }}>
                                  {checkedBagKg}kg, carrier's standard
                                </span>
                              )}
                            </>
                          )}
                        </td>
                        <td
                          style={{
                            padding: '9px 0',
                            textAlign: 'right',
                            color: '#191c1d',
                            verticalAlign: 'top',
                          }}
                        >
                          {scenario === 'travel_light' && (
                            <span style={{ color: '#6f797a' }}>Included</span>
                          )}
                          {scenario !== 'travel_light' &&
                            (scenarioBagCost > 0 ? gbp(scenarioBagCost) : '—')}
                        </td>
                      </tr>

                      <tr style={{ borderBottom: '1px solid #e1e3e3' }}>
                        <td style={{ padding: '9px 0', color: '#3f484a' }}>Seat selection</td>
                        <td style={{ padding: '9px 0', textAlign: 'right', color: '#191c1d' }}>
                          {seatCost > 0 ? gbp(seatCost) : '—'}
                        </td>
                      </tr>

                      <tr style={{ borderBottom: '1px solid #e1e3e3' }}>
                        <td style={{ padding: '9px 0', color: '#3f484a' }}>
                          Transfer to {row.outbound_airport}
                        </td>
                        <td style={{ padding: '9px 0', textAlign: 'right', color: '#191c1d' }}>
                          {row.transfer_cost_known ? gbp(transferCost) : (
                            <span style={{ color: '#6f797a', fontStyle: 'italic' }}>unavailable</span>
                          )}
                        </td>
                      </tr>

                      <tr>
                        <td
                          style={{
                            padding: '14px 0 0',
                            fontWeight: 700,
                            fontSize: 15,
                            color: '#191c1d',
                          }}
                        >
                          All-in total
                        </td>
                        <td
                          style={{
                            padding: '14px 0 0',
                            textAlign: 'right',
                            fontWeight: 700,
                            fontSize: 17,
                            color: '#004349',
                          }}
                        >
                          {gbp(scenarioTotal)}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {/* Seating policy — all known carriers */}
                  {policyCarriers.length > 0 && (
                    <div
                      style={{
                        marginTop: 16,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      {policyCarriers.map((code) => {
                        const policy = SEATING_POLICY[code]
                        return (
                          <div
                            key={code}
                            style={{
                              padding: '11px 14px',
                              background: policy.risk ? '#fffbeb' : '#f2f4f4',
                              borderRadius: 8,
                              borderLeft: `3px solid ${policy.risk ? '#fdba49' : '#bfc8c9'}`,
                            }}
                          >
                            <p
                              style={{
                                margin: 0,
                                fontSize: 13,
                                color: policy.risk ? '#78350f' : '#3f484a',
                                lineHeight: 1.55,
                              }}
                            >
                              <strong>{AIRLINE_NAMES[code] ?? code}:</strong> {policy.text}
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <p
        style={{
          marginTop: 16,
          fontSize: 12,
          color: '#6f797a',
          fontStyle: 'italic',
          lineHeight: 1.5,
        }}
      >
        Baggage fees verified June 2026 from airline booking flows. Fees vary by route and date.
      </p>
    </section>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
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
      {label}
    </span>
  )
}
