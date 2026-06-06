'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AirportRow {
  airport_iata: string
  outbound_fare: number
  return_fare: number
  total_fare: number
  has_transit_data: boolean
  public_cost: number | null
  public_method: string | null
  public_duration_mins: number | null
  uber_low: number | null
  uber_high: number | null
  uber_mid: number | null
  drive_duration_mins: number | null
  allin_public: number | null
  allin_uber_mid: number | null
  saving_vs_lhr_public: number | null
  saving_vs_lhr_uber: number | null
  is_best_value: boolean
  is_baseline: boolean
}

interface MultiAirportData {
  outbound_date: string
  return_date: string
  airports: AirportRow[]
}

export interface MultiAirportProps {
  data: MultiAirportData | null
  postcodeDistrict: string | null
}

type SortKey = 'allin' | 'fare' | 'transfer'

// ── Constants ─────────────────────────────────────────────────────────────────

const AIRPORT_NAMES: Record<string, string> = {
  LHR: 'Heathrow',
  LGW: 'Gatwick',
  STN: 'Stansted',
  LTN: 'Luton',
  LCY: 'City',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function gbp(n: number | null | undefined) {
  if (n == null) return '—'
  return `£${Math.round(n).toLocaleString('en-GB')}`
}

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d.getDate()} ${months[d.getMonth()]}`
}

function sortedAirports(airports: AirportRow[], key: SortKey): AirportRow[] {
  return [...airports].sort((a, b) => {
    if (key === 'allin') {
      if (a.allin_public == null && b.allin_public == null) return 0
      if (a.allin_public == null) return 1
      if (b.allin_public == null) return -1
      return a.allin_public - b.allin_public
    }
    if (key === 'fare') return a.total_fare - b.total_fare
    // transfer time
    if (a.public_duration_mins == null && b.public_duration_mins == null) return 0
    if (a.public_duration_mins == null) return 1
    if (b.public_duration_mins == null) return -1
    return a.public_duration_mins - b.public_duration_mins
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MultiAirport({ data, postcodeDistrict }: MultiAirportProps) {
  const [open, setOpen] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('allin')

  const district = postcodeDistrict ?? 'your area'
  const airports = data?.airports ?? []
  const bestAirport = airports.find(a => a.is_best_value) ?? null

  const sorted = sortedAirports(airports, sortKey)

  const SORT_OPTIONS: { key: SortKey; label: string }[] = [
    { key: 'allin',    label: 'Total from home' },
    { key: 'fare',     label: 'Fare only' },
    { key: 'transfer', label: 'Transfer time' },
  ]

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
      {/* Header toggle — always visible */}
      <button
        onClick={() => setOpen(v => !v)}
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
            Which London airport saves you most?
          </div>
          <div style={{ fontSize: 13, color: '#6f797a', lineHeight: 1.4 }}>
            All 5 airports compared for your dates, including transport from {district}.
          </div>
        </div>
        <div style={{ marginLeft: 16, flexShrink: 0, color: '#004349', paddingTop: 2 }}>
          {open ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </div>
      </button>

      {/* Collapsible body */}
      {open && (
        <div style={{ marginTop: 20 }}>

          {/* No data state */}
          {airports.length === 0 && (
            <p style={{ fontSize: 14, color: '#718096', margin: 0 }}>
              Airport comparison not available for these dates.
            </p>
          )}

          {airports.length > 0 && (
            <>
              {/* Sort controls + best value banner row */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                {/* Best value banner */}
                {bestAirport && bestAirport.allin_public != null && (
                  <div
                    style={{
                      background: '#e8f4f5',
                      borderLeft: '3px solid #004349',
                      padding: '12px 16px',
                      borderRadius: '0 8px 8px 0',
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <span style={{ fontSize: 14, color: '#2d3748' }}>
                      ✈{' '}
                      <strong>{AIRPORT_NAMES[bestAirport.airport_iata] ?? bestAirport.airport_iata}</strong>
                      {' '}({bestAirport.airport_iata}) is the best value from {district} —{' '}
                      <strong style={{ color: '#004349' }}>{gbp(bestAirport.allin_public)}</strong>
                      {' '}all-in
                      {bestAirport.public_method ? ` including ${bestAirport.public_method}` : ''}.
                    </span>
                  </div>
                )}

                {/* Sort pills */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignSelf: 'center' }}>
                  {SORT_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => setSortKey(opt.key)}
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        fontFamily: 'Inter, sans-serif',
                        padding: '6px 14px',
                        borderRadius: 9999,
                        border: sortKey === opt.key ? 'none' : '1px solid #bfc8c9',
                        background: sortKey === opt.key ? '#004349' : 'transparent',
                        color: sortKey === opt.key ? '#ffffff' : '#6f797a',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Airport rows */}
              <div>
                {sorted.map((airport, idx) => (
                  <div
                    key={airport.airport_iata}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 16,
                      padding: '16px 0',
                      borderBottom: idx < sorted.length - 1 ? '1px solid #bfc8c9' : 'none',
                      background: airport.is_best_value ? '#f0f8f9' : 'transparent',
                      marginLeft: airport.is_best_value ? -8 : 0,
                      paddingLeft: airport.is_best_value ? 8 : 0,
                      paddingRight: airport.is_best_value ? 8 : 0,
                      borderRadius: airport.is_best_value ? 8 : 0,
                    }}
                  >
                    {/* Left — airport badge + name */}
                    <div style={{ width: 200, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 8,
                          background: airport.is_best_value ? '#004349' : '#e1e3e3',
                          color: airport.is_best_value ? '#ffffff' : '#191c1d',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 14,
                          fontWeight: 700,
                          flexShrink: 0,
                          letterSpacing: '0.02em',
                        }}
                      >
                        {airport.airport_iata}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#191c1d', lineHeight: 1.3 }}>
                          {AIRPORT_NAMES[airport.airport_iata] ?? airport.airport_iata}
                        </div>
                        {airport.is_best_value && (
                          <div
                            style={{
                              display: 'inline-block',
                              marginTop: 3,
                              fontSize: 10,
                              fontWeight: 600,
                              background: '#004349',
                              color: '#ffffff',
                              borderRadius: 20,
                              padding: '1px 7px',
                            }}
                          >
                            ★ Best value
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Middle-left — fare breakdown */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: '#6f797a', lineHeight: 1.6 }}>
                        ↑ {gbp(airport.outbound_fare)} · {data ? fmtDate(data.outbound_date) : ''}
                      </div>
                      <div style={{ fontSize: 12, color: '#6f797a', lineHeight: 1.6 }}>
                        ↓ {gbp(airport.return_fare)} · {data ? fmtDate(data.return_date) : ''}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#191c1d', marginTop: 2 }}>
                        {gbp(airport.total_fare)} flights
                      </div>
                    </div>

                    {/* Middle-right — transfer */}
                    <div style={{ width: 180, flexShrink: 0 }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: '#6f797a',
                          marginBottom: 4,
                        }}
                      >
                        Transfer
                      </div>
                      {airport.public_duration_mins != null ? (
                        <>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#191c1d', lineHeight: 1.2 }}>
                            {airport.public_duration_mins} min
                          </div>
                          {airport.public_method && (
                            <div style={{ fontSize: 11, color: '#6f797a', marginTop: 2, lineHeight: 1.4 }}>
                              {airport.public_method}
                            </div>
                          )}
                          {airport.public_cost != null && (
                            <div style={{ fontSize: 12, color: '#191c1d', marginTop: 2 }}>
                              {gbp(airport.public_cost)}
                            </div>
                          )}
                        </>
                      ) : (
                        <div style={{ fontSize: 12, color: '#9aa5a6' }}>No data</div>
                      )}
                    </div>

                    {/* Right — all-in total */}
                    <div style={{ width: 120, flexShrink: 0, textAlign: 'right' }}>
                      <div
                        style={{
                          fontSize: 11,
                          color: '#6f797a',
                          marginBottom: 4,
                          lineHeight: 1.3,
                        }}
                      >
                        All-in from home
                      </div>
                      <div
                        style={{
                          fontSize: 18,
                          fontWeight: 700,
                          color: airport.is_best_value ? '#004349' : '#191c1d',
                          lineHeight: 1.1,
                        }}
                      >
                        {gbp(airport.allin_public)}
                      </div>
                      {airport.saving_vs_lhr_public != null &&
                       airport.saving_vs_lhr_public > 0 &&
                       !airport.is_baseline && (
                        <div style={{ fontSize: 11, color: '#004349', marginTop: 2 }}>
                          {gbp(airport.saving_vs_lhr_public)} less than LHR
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
