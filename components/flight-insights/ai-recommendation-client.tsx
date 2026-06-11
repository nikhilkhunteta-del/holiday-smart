'use client';

import { useEffect, useRef, useState } from 'react';
import { useFlightInsights } from './flight-insights-context';

interface FetchParams {
  destinationSlug: string;
  schoolUrn: string;
  tripType: string;
  adults: number;
  children: number;
  infants: number;
  cabinBags: number;
  checkedBags: number;
  seatsTogether: boolean;
  transitPreference: 'auto' | 'uber';
  windowStart: string;
  windowEnd: string;
  postcodeDistrict: string;
  schoolName: string | null;
  borough: string | null;
}

interface AIRecommendationClientProps {
  fetchParams: FetchParams;
  schoolName: string | null;
  hasInsetDay?: boolean;
  children?: React.ReactNode;
  recommendation?: {
    outbound_date: string;
    outbound_carrier: string;
    origin_iata: string;
    out_dest_iata: string;
    outbound_departure_time: string | null;
    return_date: string;
    return_carrier: string;
    ret_dest_iata: string;
    return_arrival_time: string | null;
  } | null;
  combinations?: Array<Record<string, any>> | null;
}

function fmtShortDate(iso: string): string {
  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun',
                  'Jul','Aug','Sep','Oct','Nov','Dec'];
  const d = new Date(iso + 'T00:00:00');
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function carrierName(iata: string): string {
  const map: Record<string, string> = {
    BA: 'British Airways', U2: 'easyJet', FR: 'Ryanair',
    VY: 'Vueling', W6: 'Wizz Air', TP: 'TAP',
  };
  return map[iata] ?? iata;
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function NarrativeSkeleton({ schoolName, hasInsetDay }: {
  schoolName: string | null;
  hasInsetDay?: boolean;
}) {
  const lines = [
    "We're doing the maths most families never bother with.",
    'Checking every flight combination for your half-term.',
    'Comparing bags, seats and transport — not just fares.',
    `Applying ${schoolName ?? 'your school'}'s exact school calendar.`,
    hasInsetDay
      ? 'Looking for the inset day advantage...'
      : 'Finding your best option...',
  ];

  const [visibleIndex, setVisibleIndex] = useState<number>(0);
  const [visible, setVisible] = useState<boolean>(true);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let intervalId: ReturnType<typeof setInterval>;
    intervalId = setInterval(() => {
      setVisible(false);
      timeoutId = setTimeout(() => {
        setVisibleIndex((prev: number) => {
          const next = Math.min(prev + 1, lines.length - 1);
          if (next >= lines.length - 1) clearInterval(intervalId);
          return next;
        });
        setVisible(true);
      }, 200);
    }, 2000);
    return () => {
      clearInterval(intervalId);
      clearTimeout(timeoutId);
    };
  }, [lines.length]);

  const lineStyle = {
    fontSize: 15,
    color: '#191c1d',
    lineHeight: 1.5,
    display: 'flex',
    alignItems: 'flex-start' as const,
    gap: 10,
  };

  const iconStyle = {
    fontSize: 13,
    color: '#004349',
    flexShrink: 0,
    marginTop: 1,
  };

  return (
    <div style={{
      background: '#ffffff',
      borderRadius: 16,
      boxShadow: '0 2px 12px rgba(13,92,99,0.08)',
      padding: '32px 24px',
      fontFamily: 'Inter, sans-serif',
    }}>
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        color: '#004349',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        marginBottom: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span className="spinner" />
        Analysing your options
      </div>

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        .spinner {
          display: inline-block;
          width: 14px;
          height: 14px;
          border: 2px solid #bfc8c9;
          border-top-color: #004349;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          flex-shrink: 0;
        }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {lines.slice(0, visibleIndex).map((line, i) => (
          <div key={i} style={{ ...lineStyle, opacity: 1 }}>
            <span style={iconStyle}>✓</span>
            <span>{line}</span>
          </div>
        ))}
        <div
          style={{
            ...lineStyle,
            opacity: visible ? 1 : 0,
            transition: 'opacity 0.2s ease',
          }}
        >
          <span style={iconStyle}>✓</span>
          <span>{lines[visibleIndex]}</span>
        </div>
      </div>
    </div>
  );
}

// ── Lever card ────────────────────────────────────────────────────────────────

const LEVER_COLOURS: Record<string, string> = {
  inset_day:               '#004349',
  absence_tradeoff:        '#805600',
  departure_airport:       '#004349',
  outbound_arrival_airport:'#004349',
  return_arrival_airport:  '#004349',
  travel_light:            '#805600',
  checked_bags:            '#805600',
  transport_outbound:      '#3f484a',
  transport_return:        '#3f484a',
  split_carrier:           '#004349',
  family_split_risk:       '#ba1a1a',
  bags_estimate:           '#6f797a',
  transit_changes:         '#3f484a',
  allin_trap:              '#805600',
  value_tradeoff:          '#004349',
};

function LeverCard({ insight }: {
  insight: {
    lever: string;
    headline?: string;
    insight: string;
    saving_gbp?: number | null;
  }
}) {
  const colour = LEVER_COLOURS[insight.lever] ?? '#3f484a';
  return (
    <div style={{
      background: '#f8fafa',
      border: '1px solid #e1e3e3',
      borderRadius: 12,
      padding: '14px 16px',
    }}>
      {insight.headline && (
        <div style={{
          fontSize: 11,
          fontWeight: 700,
          color: colour,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          marginBottom: 6,
        }}>
          {insight.headline}
        </div>
      )}
      <div style={{
        fontSize: 13,
        color: '#3f484a',
        lineHeight: 1.5,
      }}>
        {insight.insight}
      </div>
      {insight.saving_gbp != null && insight.saving_gbp > 0 && (
        <div style={{
          marginTop: 8,
          fontSize: 13,
          fontWeight: 700,
          color: '#004349',
        }}>
          Save £{Math.round(insight.saving_gbp)}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AIRecommendationClient({ fetchParams, schoolName, hasInsetDay, children, recommendation, combinations }: AIRecommendationClientProps) {
  const { aiResult, aiLoading, setAIResult, setAILoading } = useFlightInsights();
  const abortRef = useRef<AbortController | null>(null);
  const prevParamsRef = useRef<string>('');

  useEffect(() => {
    const paramsKey = JSON.stringify(fetchParams);

    // Skip if params haven't changed
    if (paramsKey === prevParamsRef.current) return;
    prevParamsRef.current = paramsKey;

    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setAILoading(true);

    fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fetchParams),
      signal: abortRef.current.signal,
    })
      .then(r => {
        if (!r.ok) throw new Error(`API error: ${r.status}`);
        return r.json();
      })
      .then(data => {
          // Match by date fields — more robust than index which may differ
          // between server combinations order and client combinations order
          const winnerOutbound = data.winner_outbound_date;
          const winnerReturn   = data.winner_return_date;
          const winnerCarrier  = data.winner_outbound_carrier;

          const resolvedCombination = combinations?.find(c =>
            c.outbound_date    === winnerOutbound &&
            c.return_date      === winnerReturn &&
            c.outbound_carrier === winnerCarrier
          ) ?? combinations?.[data.recommended_index ?? 0] ?? null;

          console.log('[client] recommended_index from API:', data.recommended_index ?? 0);
          console.log('[client] combinations array length:', combinations?.length);
          console.log('[client] resolved combination:',
            JSON.stringify({
              out: resolvedCombination?.outbound_date,
              ret: resolvedCombination?.return_date,
            })
          );
          setAIResult({ ...data, recommendedCombination: resolvedCombination });
        })
      .catch(err => {
        if (err.name === 'AbortError') return; // cancelled — ignore
        console.error('[AIRecommendationClient] fetch error:', err);
        setAILoading(false);
      });

    return () => {
      abortRef.current?.abort();
    };
  }, [
    fetchParams.cabinBags,
    fetchParams.checkedBags,
    fetchParams.seatsTogether,
    fetchParams.transitPreference,
    fetchParams.schoolUrn,
    fetchParams.windowStart,
    fetchParams.windowEnd,
  ]);

  if (aiLoading && !aiResult) return (
    <main className="min-h-screen bg-background">
      <div className="max-w-content mx-auto px-margin-desktop py-xl flex flex-col gap-xl">
        <NarrativeSkeleton schoolName={schoolName} hasInsetDay={hasInsetDay} />
      </div>
    </main>
  );

  return (
    <>
      {aiResult && !aiResult.fallback && (
        <div style={{
          background: '#ffffff',
          borderRadius: 16,
          boxShadow: '0 2px 12px rgba(13,92,99,0.08)',
          padding: 24,
          fontFamily: 'Inter, sans-serif',
          animation: 'fadeIn 0.4s ease',
        }}>
          <style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>
          {/* Problem statement */}
          {aiResult.problem_statement && (
            <p style={{
              fontFamily: 'Newsreader, serif',
              fontSize: 22,
              fontWeight: 600,
              color: '#191c1d',
              lineHeight: 1.4,
              margin: '0 0 12px',
            }}>
              {aiResult.problem_statement}
            </p>
          )}
          {/* Headline */}
          {aiResult.headline && (
            <p style={{
              fontFamily: 'Newsreader, serif',
              fontSize: 28,
              fontWeight: 600,
              color: '#191c1d',
              lineHeight: 1.3,
              margin: '0 0 8px',
            }}>
              {aiResult.headline}
            </p>
          )}
          {/* Subheadline */}
          {aiResult.subheadline && (
            <p style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: 14,
              color: '#6f797a',
              lineHeight: 1.5,
              margin: '0 0 20px',
            }}>
              {aiResult.subheadline}
            </p>
          )}
          {/* Itinerary strip */}
          {(() => {
            const stripRec = aiResult?.recommendedCombination ?? recommendation;
            return stripRec ? (
            <div style={{
              borderLeft: '2px solid #004349',
              paddingLeft: 16,
              margin: '16px 0',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}>
              <div style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#004349',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 4,
              }}>
                Our pick
              </div>
              <div style={{
                display: 'flex',
                gap: 8,
                fontSize: 13,
                color: '#191c1d',
                alignItems: 'center',
              }}>
                <span style={{ color: '#6f797a', minWidth: 56 }}>Outbound</span>
                <span style={{ fontWeight: 600 }}>
                  {fmtShortDate(stripRec.outbound_date)}
                </span>
                <span>·</span>
                <span>{carrierName(stripRec.outbound_carrier)}</span>
                <span>·</span>
                <span>{stripRec.origin_iata} → {stripRec.out_dest_iata}</span>
                {stripRec.outbound_departure_time && (
                  <>
                    <span>·</span>
                    <span>departs {stripRec.outbound_departure_time.slice(0,5)}</span>
                  </>
                )}
              </div>
              <div style={{
                display: 'flex',
                gap: 8,
                fontSize: 13,
                color: '#191c1d',
                alignItems: 'center',
              }}>
                <span style={{ color: '#6f797a', minWidth: 56 }}>Return</span>
                <span style={{ fontWeight: 600 }}>
                  {fmtShortDate(stripRec.return_date)}
                </span>
                <span>·</span>
                <span>{carrierName(stripRec.return_carrier)}</span>
                <span>·</span>
                <span>{stripRec.ret_dest_iata} → {stripRec.origin_iata}</span>
                {stripRec.return_arrival_time && (
                  <>
                    <span>·</span>
                    <span>arrives {stripRec.return_arrival_time.slice(0,5)}</span>
                  </>
                )}
              </div>
            </div>
            ) : null;
          })()}
          {/* Lever cards */}
          {aiResult.lever_insights.length > 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 12,
            }}>
              {aiResult.lever_insights.map((insight, i) => (
                <LeverCard key={i} insight={insight} />
              ))}
            </div>
          )}
          {/* Caveats */}
          {aiResult.caveats.length > 0 && (
            <div style={{ marginTop: 16 }}>
              {aiResult.caveats.map((c, i) => (
                <p key={i} style={{
                  fontSize: 12,
                  color: '#6f797a',
                  margin: '2px 0',
                  lineHeight: 1.5,
                }}>
                  * {c}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
      {children && (
        <div style={{ animation: 'fadeIn 0.4s ease' }}>
          {children}
        </div>
      )}
    </>
  );
}
