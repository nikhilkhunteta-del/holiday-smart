'use client'

import { useState } from 'react'

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
  bundle_name: string | null
  bundle_price_delta_gbp: number | null
  bundle_includes_checked: boolean | null
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

const AIRLINE_NAMES: Record<string, string> = {
  FR: 'Ryanair',
  U2: 'easyJet',
  W6: 'Wizz Air',
  VY: 'Vueling',
  TP: 'TAP Air Portugal',
  BA: 'British Airways',
}

const VERIFIED_CARRIERS = new Set(['FR', 'U2', 'W6', 'VY', 'TP', 'BA'])

const SEATING_POLICY: Record<string, { risk: boolean; text: string }> = {
  FR: {
    risk: true,
    text: 'Ryanair allocates seats randomly. With your party size, seats together are not guaranteed unless you pay for selection. Note: first adult travelling with a child gets a free seat.',
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

function gbp(n: number) {
  return `£${Math.round(n).toLocaleString('en-GB')}`
}

export function AllInCost({ data, tripType, destinationAirport }: Props) {
  const [includeBag, setIncludeBag] = useState(tripType === 'circuit')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  if (!data || !data.carriers || data.carriers.length === 0) return null

  return (
    <section style={{ marginTop: 48, fontFamily: 'Inter, sans-serif' }}>
      <h2
        style={{
          fontFamily: 'Newsreader, serif',
          fontSize: 28,
          fontWeight: 500,
          color: '#191c1d',
          lineHeight: 1.3,
          margin: '0 0 8px',
        }}
      >
        All-in family cost
      </h2>
      <p style={{ fontSize: 16, color: '#6f797a', margin: '0 0 24px', lineHeight: 1.6 }}>
        Base fare + hold luggage + seat selection. What you'll actually pay.
      </p>

      {/* Global bag toggle */}
      <div
        style={{
          display: 'inline-flex',
          borderRadius: 12,
          border: '1px solid #bfc8c9',
          overflow: 'hidden',
          marginBottom: 24,
        }}
      >
        <button
          onClick={() => setIncludeBag(false)}
          style={{
            padding: '8px 18px',
            fontSize: 14,
            fontWeight: 600,
            fontFamily: 'Inter, sans-serif',
            border: 'none',
            cursor: 'pointer',
            background: !includeBag ? '#004349' : '#ffffff',
            color: !includeBag ? '#ffffff' : '#3f484a',
          }}
        >
          No checked bag
        </button>
        <button
          onClick={() => setIncludeBag(true)}
          style={{
            padding: '8px 18px',
            fontSize: 14,
            fontWeight: 600,
            fontFamily: 'Inter, sans-serif',
            border: 'none',
            borderLeft: '1px solid #bfc8c9',
            cursor: 'pointer',
            background: includeBag ? '#004349' : '#ffffff',
            color: includeBag ? '#ffffff' : '#3f484a',
          }}
        >
          1 checked bag
        </button>
      </div>

      {/* Carrier cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {data.carriers.map((row) => {
          const key = `${row.outbound_carrier}-${row.return_carrier}`
          const isExpanded = expandedKey === key
          const airlineName = AIRLINE_NAMES[row.outbound_carrier] ?? row.outbound_carrier

          const bagCost = includeBag ? (row.baggage_cost ?? 0) : 0
          const seatCost = row.seat_cost ?? 0
          const transferCost = row.transfer_cost ?? 0
          const displayTotal = row.base_fare_total + bagCost + seatCost + transferCost
          const headlinePP = row.base_fare_total / row.party_size

          const barComponents = row.base_fare_total + bagCost + seatCost
          const basePct = barComponents > 0 ? (row.base_fare_total / barComponents) * 100 : 100
          const bagPct = barComponents > 0 ? (bagCost / barComponents) * 100 : 0
          const seatPct = barComponents > 0 ? (seatCost / barComponents) * 100 : 0

          const isVerified = VERIFIED_CARRIERS.has(row.outbound_carrier)

          // Carriers to show seating policy for in the expanded breakdown
          const policyCarriers = Array.from(
            new Set([row.outbound_carrier, row.return_carrier])
          ).filter((c) => c in SEATING_POLICY)

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
                  <div style={{ fontSize: 14, color: '#6f797a', fontFamily: 'Inter, sans-serif' }}>
                    {row.outbound_airport}
                    {destinationAirport ? ` → ${destinationAirport}` : ''}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {row.is_recommended && (
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
                {includeBag && bagCost > 0 && (
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
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: '#004349',
                      flexShrink: 0,
                    }}
                  />
                  Base fares (×{row.party_size}): {gbp(row.base_fare_total)}
                </span>
                {includeBag && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        background: '#fdba49',
                        flexShrink: 0,
                      }}
                    />
                    Hold luggage: {bagCost > 0 ? gbp(bagCost) : 'n/a'}
                  </span>
                )}
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: '#fde68a',
                      flexShrink: 0,
                    }}
                  />
                  Seat selection: {seatCost > 0 ? gbp(seatCost) : '—'}
                </span>
              </div>

              {/* Headline / True total */}
              <div style={{ fontSize: 15, color: '#191c1d', marginBottom: 12 }}>
                <span style={{ color: '#6f797a' }}>Headline:</span>{' '}
                <strong>{gbp(headlinePP)}pp</strong>
                <span style={{ color: '#bfc8c9', margin: '0 8px' }}>·</span>
                <span style={{ color: '#6f797a' }}>True total:</span>{' '}
                <strong style={{ color: '#004349', fontSize: 17 }}>{gbp(displayTotal)}</strong>
              </div>

              {/* Edge-case notices */}
              {!row.allin_is_complete && (
                <div
                  style={{
                    fontSize: 12,
                    color: '#6f797a',
                    fontStyle: 'italic',
                    marginBottom: 10,
                  }}
                >
                  Transfer cost not included — school-to-airport transit data unavailable for this route.
                </div>
              )}
              {!isVerified && (
                <div
                  style={{
                    fontSize: 12,
                    color: '#92400e',
                    marginBottom: 10,
                  }}
                >
                  Baggage fees unverified — this carrier is not in our confirmed dataset.
                </div>
              )}

              {/* Show full breakdown link */}
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
                  <table
                    style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}
                  >
                    <tbody>
                      <tr style={{ borderBottom: '1px solid #e1e3e3' }}>
                        <td style={{ padding: '9px 0', color: '#3f484a' }}>Headline fare</td>
                        <td style={{ padding: '9px 0', textAlign: 'right', color: '#191c1d' }}>
                          {gbp(row.base_fare_total)}
                        </td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #e1e3e3' }}>
                        <td style={{ padding: '9px 0', color: '#3f484a' }}>
                          Hold luggage
                          {includeBag && row.baggage_is_estimate && (
                            <span
                              style={{
                                fontSize: 11,
                                color: '#6f797a',
                                fontStyle: 'italic',
                                marginLeft: 6,
                              }}
                            >
                              estimated
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '9px 0', textAlign: 'right', color: '#191c1d' }}>
                          {includeBag ? (bagCost > 0 ? gbp(bagCost) : 'n/a') : '—'}
                        </td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #e1e3e3' }}>
                        <td style={{ padding: '9px 0', color: '#3f484a' }}>Seat selection</td>
                        <td style={{ padding: '9px 0', textAlign: 'right', color: '#191c1d' }}>
                          {seatCost > 0 ? gbp(seatCost) : '—'}
                        </td>
                      </tr>
                      {row.transfer_cost !== null && (
                        <tr style={{ borderBottom: '1px solid #e1e3e3' }}>
                          <td style={{ padding: '9px 0', color: '#3f484a' }}>
                            Transfer to {row.outbound_airport}
                          </td>
                          <td style={{ padding: '9px 0', textAlign: 'right', color: '#191c1d' }}>
                            {gbp(transferCost)}
                          </td>
                        </tr>
                      )}
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
                          {gbp(displayTotal)}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {/* Seating policy — shown for all known carriers */}
                  {policyCarriers.length > 0 && (
                    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {policyCarriers.map((code) => {
                        const policy = SEATING_POLICY[code]
                        return (
                          <div
                            key={code}
                            style={{
                              padding: '12px 14px',
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

      {/* Component footer */}
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
