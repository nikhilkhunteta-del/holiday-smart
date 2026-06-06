'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface BucketSplitData {
  composition: string
  together_price: number
  split_price: number | null
  saving: number | null
  above_threshold: boolean | null
  is_estimated: boolean
  recommended: 'split' | 'together'
  one_a_one_c_price?: number
  solo_adult_estimate?: number
  error?: string
}

export interface BucketSplitProps {
  data: BucketSplitData | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function gbp(n: number) {
  return `£${Math.round(n).toLocaleString('en-GB')}`
}

function partyLabel(composition: string) {
  if (composition === '2A+2C') return '4 passengers'
  if (composition === '2A+1C') return '3 passengers'
  return composition
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BucketSplit({ data }: BucketSplitProps) {
  const [open, setOpen] = useState(false)

  // Case 1 — null, error, or missing split_price
  if (!data || data.error || data.split_price == null) return null

  const saving = data.saving ?? 0
  const hasSaving = saving > 0
  const party = partyLabel(data.composition)

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
      {/* Header row — always visible */}
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
            Could splitting your booking save money?
          </div>
          <div style={{ fontSize: 13, color: '#6f797a', lineHeight: 1.4 }}>
            We checked whether booking as two separate transactions beats one family booking.
          </div>
        </div>
        <div style={{ marginLeft: 16, flexShrink: 0, color: '#004349', paddingTop: 2 }}>
          {open ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </div>
      </button>

      {/* Collapsible body */}
      {open && (
        <div style={{ marginTop: 20 }}>
          {/* Case 3 — no saving */}
          {!hasSaving && (
            <p style={{ fontSize: 14, color: '#718096', margin: 0, lineHeight: 1.6 }}>
              No saving found. We compared booking {party} together against splitting into
              separate smaller transactions on your recommended route — both came to the same price.
            </p>
          )}

          {/* Case 2 — split saves money */}
          {hasSaving && (
            <>
              {/* Saving banner */}
              <div
                style={{
                  background: '#e8f4f5',
                  borderLeft: '3px solid #004349',
                  padding: '12px 16px',
                  borderRadius: '0 8px 8px 0',
                  marginBottom: 20,
                }}
              >
                <span style={{ fontSize: 14, color: '#2d3748' }}>
                  Booking as two separate transactions (1 adult + 1 child each) could save{' '}
                  <strong style={{ color: '#004349' }}>{gbp(saving)}</strong> on this route.
                </span>
              </div>

              {/* Comparison cards */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: 16,
                  marginBottom: 16,
                }}
              >
                {/* Together card */}
                <div
                  style={{
                    background: '#f8fafa',
                    borderRadius: 12,
                    padding: '16px 20px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: '#718096',
                      marginBottom: 8,
                    }}
                  >
                    One booking
                  </div>
                  <div
                    style={{
                      fontFamily: 'Newsreader, Georgia, serif',
                      fontSize: 28,
                      color: '#1a202c',
                      lineHeight: 1,
                      marginBottom: 6,
                    }}
                  >
                    {gbp(data.together_price)}
                  </div>
                  <div style={{ fontSize: 12, color: '#718096' }}>
                    {party} · one transaction
                  </div>
                </div>

                {/* Split card */}
                <div
                  style={{
                    background: '#f0f9fa',
                    borderRadius: 12,
                    padding: '16px 20px',
                    border: '1px solid #b2d8db',
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: '#004349',
                      marginBottom: 8,
                    }}
                  >
                    Two bookings
                  </div>
                  <div
                    style={{
                      fontFamily: 'Newsreader, Georgia, serif',
                      fontSize: 28,
                      color: '#004349',
                      lineHeight: 1,
                      marginBottom: 6,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    {gbp(data.split_price)}
                    <span
                      style={{
                        fontSize: 11,
                        fontFamily: 'Inter, sans-serif',
                        background: '#004349',
                        color: '#ffffff',
                        borderRadius: 20,
                        padding: '2px 10px',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Save {gbp(saving)}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#4a5568' }}>
                    2 × (1 adult + 1 child) · separate transactions
                    {data.is_estimated && (
                      <span style={{ color: '#718096' }}> · one fare estimated</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Caveat note */}
              <p
                style={{
                  fontSize: 12,
                  color: '#718096',
                  margin: 0,
                  lineHeight: 1.6,
                }}
              >
                Book at separate times or use different browsers to avoid airlines linking the
                transactions. Prices may differ slightly between bookings.
                {data.is_estimated && (
                  <> The solo adult fare is estimated — check actual prices before booking.</>
                )}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
