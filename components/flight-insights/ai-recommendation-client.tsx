'use client';

import { useEffect, useRef, useState } from 'react';
import { useFlightInsights } from './flight-insights-context';
import { ScenarioStrip } from './scenario-strip';
import type { ScenarioResult } from '@/lib/flights/buildScenarioResults';

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
  currentPageUrl?: string;
  savingCategory: string;
  combinationCount: number;
  baselineIsRecommended?: boolean;
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
  hsSaving?: number;
  benchmarkCost?: number | null;
  scenarios?: ScenarioResult[];
  baseline?: {
    outbound_date: string;
    return_date: string;
    origin_iata: string;
    carrier: string;
    outbound_departure_time: string | null;
    total_cost_gbp: number;
  } | null;
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

function fmtDuration(mins: number | null | undefined): string {
  if (!mins) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function buildGoogleFlightsUrl(params: {
  origin: string;
  destination: string;
  date: string;
  adults: number;
  children: number;
}): string {
  return `https://www.google.com/travel/flights?q=One+way+flights+from+${params.origin}+to+${params.destination}+on+${params.date}&adults=${params.adults}&children=${params.children}&trip_type=one_way`;
}

function buildGoogleFlightsRoundTripUrl(params: {
  origin:      string;
  destination: string;
  outbound:    string;
  return_date: string;
  adults:      number;
  children:    number;
}): string {
  return `https://www.google.com/travel/flights` +
    `#flt=${params.origin}.${params.destination}` +
    `.${params.outbound}*${params.destination}` +
    `.${params.origin}.${params.return_date}` +
    `;c:GBP;e:1;sd:1;t:f` +
    `&adults=${params.adults}&children=${params.children}`;
}

const LEVER_ICONS: Record<string, string> = {
  inset_day:            'calendar_today',
  value_tradeoff:       'compare_arrows',
  near_miss:            'search',
  travel_light:         'backpack',
  split_carrier:        'multiple_stop',
  transport_outbound:   'directions_bus',
  transport_return:     'commute',
  transit_changes:      'transfer_within_a_station',
  allin_trap:           'calculate',
  checked_bags:         'luggage',
  departure_airport:    'flight_takeoff',
  early_return_warning: 'schedule',
  lead_research:        'manage_search',
  lead_saving:          'savings',
  selection_story:      'route',
};

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
    }, 1800);
    return () => {
      clearInterval(intervalId);
      clearTimeout(timeoutId);
    };
  }, [lines.length]);

  const lineStyle = {
    fontSize: 18,
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
        @keyframes loadingBar {
          0%   { width: 24px; opacity: 0.4; }
          50%  { width: 48px; opacity: 1; }
          100% { width: 24px; opacity: 0.4; }
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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

      {visibleIndex === lines.length - 1 && (
        <div style={{
          marginTop:  24,
          display:    'flex',
          alignItems: 'center',
          gap:        10,
          opacity:    0.6,
        }}>
          <div style={{
            width:       24,
            height:      2,
            background:  '#004349',
            borderRadius: 2,
            animation:   'loadingBar 1.2s ease-in-out infinite',
          }} />
          <span style={{
            fontFamily:    'Inter, sans-serif',
            fontSize:      12,
            color:         '#6f797a',
            letterSpacing: '0.04em',
          }}>
            Finding your best option...
          </span>
        </div>
      )}
    </div>
  );
}

// ── Lever card ────────────────────────────────────────────────────────────────

const LEVER_COLOURS: Record<string, string> = {
  lead_research:           '#004349',
  lead_saving:             '#004349',
  selection_story:         '#004349',
  inset_day:               '#004349',
  near_miss:               '#004349',
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
  early_return_warning:    '#805600',
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

export function AIRecommendationClient({ fetchParams, schoolName, hasInsetDay, children, recommendation, combinations, hsSaving, benchmarkCost, scenarios, baseline }: AIRecommendationClientProps) {
  const { aiResult, aiLoading, setAIResult, setAILoading } = useFlightInsights();
  const abortRef = useRef<AbortController | null>(null);
  const prevParamsRef = useRef<string>('');
  const [email, setEmail]         = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [diyOpen, setDiyOpen]     = useState(false);

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
          ) ?? combinations?.[0] ?? null;

          console.log('[client] winner lookup:', winnerOutbound, winnerCarrier);
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
      <div className="max-w-content mx-auto px-gutter py-xl flex flex-col gap-xl">
        <NarrativeSkeleton schoolName={schoolName} hasInsetDay={hasInsetDay} />
      </div>
    </main>
  );

  // ── Derive booking data ──────────────────────────────────────────────────
  const aiSaving = (() => {
    const rec = aiResult?.recommendedCombination;
    if (!rec || !benchmarkCost) return hsSaving ?? 0;
    const recCost = rec.total_cost_gbp ?? rec.total_inc_fine ?? 0;
    return Math.round(benchmarkCost - recCost);
  })();

  const rec = aiResult?.recommendedCombination ?? recommendation;

  const adults      = fetchParams.adults;
  const numChildren = fetchParams.children;

  const origin  = rec?.origin_iata   ?? '';
  const outDest = rec?.out_dest_iata ?? '';
  const retDest = (rec as any)?.ret_dest_iata ?? origin;

  const outboundUrl = rec ? buildGoogleFlightsUrl({
    origin,
    destination: outDest,
    date: rec.outbound_date,
    adults,
    children: numChildren,
  }) : '#';

  const returnUrl = rec ? buildGoogleFlightsUrl({
    origin: outDest,
    destination: retDest,
    date: rec.return_date,
    adults,
    children: numChildren,
  }) : '#';

  const isSplit = (rec as any)?.split_carrier ?? false;

  // Timeline shows only lever_insights (qualitative cards now in right column)
  const timelineCards = aiResult?.lever_insights ?? [];

  // Right column notes come from right_column_cards
  // (set by getAIRecommendation) — not lever_insights
  const rightColCards = aiResult?.right_column_cards ?? [];
  const earlyReturnNote = rightColCards
    .find(c => c.lever === 'early_return_warning') ?? null;
  const transitNote = rightColCards
    .find(c => c.lever === 'transit_changes') ?? null;

  // Insight line for itinerary strip
  const recAny = rec as Record<string, any> | null;
  let itineraryInsight = '';
  if (recAny?.is_inset_day) {
    itineraryInsight = "Flying on your school's inset day — one day earlier than most families, at no extra cost.";
  } else if (recAny && !recAny.requires_absence) {
    itineraryInsight = 'No school absence required for this trip.';
  }

  return (
    <>
      <style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>

      {/* ── Full-width header ─────────────────────────────── */}
      <div className="mb-lg">
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: 'rgba(0,67,73,0.06)',
          border: '1px solid rgba(0,67,73,0.12)',
          borderRadius: 20,
          padding: '4px 12px',
          marginBottom: 16,
        }}>
          <span style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: 11,
            fontWeight: 600,
            color: '#004349',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}>
            All prices all-in
          </span>
          <span style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: 11,
            color: '#6f797a',
          }}>
            fare · bags · seats · transport
          </span>
        </div>
        {aiResult?.problem_statement && (
          <p style={{
            fontFamily: 'Newsreader, serif',
            fontSize: 18,
            fontWeight: 400,
            color: '#3f484a',
            lineHeight: 1.6,
            marginBottom: 12,
          }}>
            {aiResult.problem_statement}
          </p>
        )}
        {aiResult?.headline && (
          <h1 style={{
            fontFamily: 'Newsreader, serif',
            fontSize: 36,
            fontWeight: 600,
            color: '#004349',
            lineHeight: 1.2,
            letterSpacing: '-0.01em',
            marginBottom: 8,
          }}>
            {aiResult.headline}
          </h1>
        )}
        {aiResult?.subheadline && (
          <p style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: 14,
            color: '#6f797a',
            lineHeight: 1.5,
          }}>
            {aiResult.subheadline}
          </p>
        )}
      </div>

      {/* ── Two-column grid ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-xl items-start mb-xl">

        {/* LEFT — Timeline steps */}
        <div className="lg:col-span-7 space-y-0">
          {timelineCards.map((card, i) => {
            const isLast = i === timelineCards.length - 1 && !(aiSaving > 0);
            const icon = LEVER_ICONS[card.lever] ?? 'lightbulb';
            const isAmber = ['travel_light', 'allin_trap', 'checked_bags',
                             'transport_outbound', 'transport_return'].includes(card.lever);

            return (
              <div
                key={i}
                className={`relative flex gap-lg pb-xl ${isLast ? 'hs-step-line-last' : 'hs-step-line'}`}
              >
                <div
                  className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center text-white z-10"
                  style={{
                    background: isAmber ? '#805600' : '#004349',
                    boxShadow: '0 2px 12px -2px rgba(13,92,99,0.08)',
                  }}
                >
                  <span className="material-symbols-outlined">{icon}</span>
                </div>
                <div className="flex-1">
                  <h3 style={{
                    fontFamily: 'Newsreader, serif',
                    fontSize: 22,
                    fontWeight: 500,
                    color: isAmber ? '#805600' : '#004349',
                    marginBottom: 8,
                    lineHeight: 1.4,
                  }}>
                    {card.headline}
                  </h3>
                  <p style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 16,
                    color: '#3f484a',
                    lineHeight: 1.6,
                    marginBottom: 12,
                    maxWidth: '42ch',
                  }}>
                    {card.insight}
                  </p>
                  {/* Badge for inset day */}
                  {card.lever === 'inset_day' && (
                    <div className="inline-flex items-center gap-sm bg-primary/5 px-md py-xs rounded-lg border border-primary/10">
                      <span className="material-symbols-outlined text-primary text-[18px]">verified</span>
                      <span className="font-label-sm text-label-sm text-primary font-bold uppercase">
                        Zero Absence Guaranteed
                      </span>
                    </div>
                  )}
                  {/* Badge for travel light */}
                  {card.lever === 'travel_light' && card.saving_gbp != null && (
                    <div style={{
                      fontFamily: 'Inter, sans-serif',
                      fontSize: 12,
                      fontWeight: 700,
                      color: '#805600',
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                    }}>
                      Optional extra saving: £{Math.round(card.saving_gbp)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Final step — Total Advantage (always shown if aiSaving > 0) */}
          {aiSaving > 0 && (
            <div className="relative flex gap-lg pb-xl hs-step-line-last">
              <div
                className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center text-white z-10 animate-pulse"
                style={{
                  background: '#F06543',
                  boxShadow: '0 2px 12px -2px rgba(240,101,67,0.2)',
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  savings
                </span>
              </div>
              <div className="flex-1">
                <h3 style={{
                  fontFamily: 'Newsreader, serif',
                  fontSize: 22,
                  fontWeight: 500,
                  color: '#F06543',
                  marginBottom: 8,
                  lineHeight: 1.4,
                }}>
                  Your total saving
                </h3>
                <p style={{
                  fontFamily: 'Inter, sans-serif',
                  fontSize: 16,
                  color: '#3f484a',
                  lineHeight: 1.6,
                  marginBottom: 16,
                  maxWidth: '42ch',
                }}>
                  {benchmarkCost != null
                    ? `Compared to the typical Saturday booking from Heathrow${fetchParams.borough ? ` — the default for most ${fetchParams.borough} families` : ''} — this trip saves your family £${Math.round(aiSaving)}.`
                    : `This optimised trip saves your family £${Math.round(aiSaving)} compared to a typical Saturday Heathrow booking.`
                  }
                </p>
                <div style={{
                  display: 'inline-block',
                  background: 'rgba(240,101,67,0.08)',
                  border: '1px solid rgba(240,101,67,0.2)',
                  borderRadius: 12,
                  padding: '12px 20px',
                }}>
                  <span style={{
                    fontFamily: 'Newsreader, serif',
                    fontSize: 36,
                    fontWeight: 600,
                    color: '#F06543',
                  }}>
                    £{Math.round(aiSaving)}
                  </span>
                  <span style={{
                    fontFamily: 'Newsreader, serif',
                    fontSize: 22,
                    fontWeight: 400,
                    color: '#F06543',
                    marginLeft: 8,
                  }}>
                    Saved
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — Sticky sidebar */}
        <div className="lg:col-span-5 lg:sticky lg:top-24">

          {/* Main booking card */}
          <div
            className="bg-white rounded-xl border border-outline-variant relative overflow-hidden"
            style={{ padding: 32, boxShadow: '0 2px 12px -2px rgba(13,92,99,0.08)' }}
          >
            {/* Smart Trip badge */}
            <div className="absolute top-0 right-0 p-lg">
              <div className="bg-primary/5 text-primary border border-primary/20 px-md py-xs rounded-full flex items-center gap-xs">
                <span className="material-symbols-outlined text-[18px]">verified</span>
                <span className="font-label-sm text-label-sm font-bold uppercase tracking-tighter">
                  Smart Trip
                </span>
              </div>
            </div>

            {fetchParams.baselineIsRecommended && baseline ? (
              /* ── Baseline sidebar (BA Heathrow round-trip) ── */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 700, color: '#6f797a', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    Best option found
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,67,73,0.06)', borderRadius: 20, padding: '4px 10px', border: '1px solid rgba(0,67,73,0.12)' }}>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 700, color: '#004349', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      Verified
                    </span>
                  </div>
                </div>

                <div style={{ fontFamily: 'Newsreader, serif', fontSize: 18, color: '#004349', fontWeight: 500 }}>
                  {(() => {
                    const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
                    return `${fmt(baseline.outbound_date)} — ${fmt(baseline.return_date)}`;
                  })()}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid #e1e3e3', paddingTop: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 15, fontWeight: 600, color: '#191c1d' }}>
                      {baseline.carrier === 'BA' ? 'British Airways' : baseline.carrier}
                    </span>
                  </div>
                  <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 22, fontWeight: 400, color: '#191c1d' }}>
                    {baseline.outbound_departure_time?.slice(0, 5) ?? '06:10'}
                    <span style={{ color: '#6f797a', margin: '0 8px' }}>–</span>
                    09:20
                  </div>
                  <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#6f797a' }}>
                    {baseline.origin_iata} → BCN &nbsp;·&nbsp; {baseline.outbound_date ? new Date(baseline.outbound_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}
                  </div>
                  <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#6f797a', fontStyle: 'italic' }}>
                    Round-trip — return {baseline.return_date ? new Date(baseline.return_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''} included
                  </div>
                </div>

                <div style={{ borderTop: '1px solid #e1e3e3', paddingTop: 12 }}>
                  <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#6f797a', marginBottom: 4 }}>
                    All-in total
                  </div>
                  <div style={{ fontFamily: 'Newsreader, serif', fontSize: 28, fontWeight: 600, color: '#004349' }}>
                    £{Math.round(baseline.total_cost_gbp)}
                  </div>
                  <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#6f797a', marginTop: 2 }}>
                    Fare + bags + transport · bags included in BA fare
                  </div>
                </div>

                <a
                  href={buildGoogleFlightsRoundTripUrl({
                    origin:      baseline.origin_iata,
                    destination: 'BCN',
                    outbound:    baseline.outbound_date,
                    return_date: baseline.return_date,
                    adults:      fetchParams.adults,
                    children:    fetchParams.children,
                  })}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'block',
                    background: '#004349',
                    color: '#ffffff',
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 13,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    textAlign: 'center',
                    textDecoration: 'none',
                    padding: '14px 20px',
                    borderRadius: 12,
                  }}
                >
                  Book · British Airways
                </a>

                <div style={{ textAlign: 'center', fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#6f797a' }}>
                  Best all-in price found across 128+ combinations
                </div>
              </div>
            ) : (
            <div className="space-y-xl">

              {/* Date summary */}
              {rec && (
                <div className="pb-md border-b border-outline-variant/30">
                  <h3 className="font-label-sm text-label-sm text-primary uppercase font-bold tracking-widest mb-sm">
                    Your Optimised Route
                  </h3>
                  <p className="font-body-md text-body-md italic text-on-surface-variant">
                    Flying {fmtShortDate(rec.outbound_date)} — {fmtShortDate(rec.return_date)}
                  </p>
                </div>
              )}

              {/* Itinerary */}
              {rec && (
                <div className="space-y-lg">
                  {/* Outbound */}
                  <div className="flex flex-col gap-md pb-lg border-b border-outline-variant/30">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-sm">
                        <div className="w-8 h-8 bg-primary/5 rounded flex items-center justify-center">
                          <span className="material-symbols-outlined text-primary text-[20px]">
                            flight_takeoff
                          </span>
                        </div>
                        <span className="font-label-md text-label-md text-primary">
                          {carrierName(rec.outbound_carrier)}
                        </span>
                      </div>
                      <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">
                        {(rec as any).outbound_duration_mins ? fmtDuration((rec as any).outbound_duration_mins) : ''}
                      </span>
                    </div>
                    <div className="flex justify-between items-end">
                      <div className="flex flex-col">
                        <div className="flex items-baseline gap-xs">
                          <span style={{
                            fontFamily: 'Newsreader, serif',
                            fontSize: 22,
                            fontWeight: 500,
                            color: '#191c1d',
                          }}>
                            {rec.outbound_departure_time?.toString().slice(0,5) ?? ''}
                          </span>
                          <span className="text-on-surface-variant">–</span>
                          <span style={{
                            fontFamily: 'Newsreader, serif',
                            fontSize: 22,
                            fontWeight: 500,
                            color: '#191c1d',
                          }}>
                            {(rec as any).outbound_arrival_time?.toString().slice(0,5) ?? ''}
                          </span>
                        </div>
                        <div className="flex gap-sm text-label-sm font-label-sm text-outline items-center">
                          <span>{rec.origin_iata}</span>
                          <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                          <span>{rec.out_dest_iata}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-label-sm text-outline">
                          {fmtShortDate(rec.outbound_date)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Return */}
                  <div className="flex flex-col gap-md pt-sm">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-sm">
                        <div className="w-8 h-8 bg-primary/5 rounded flex items-center justify-center">
                          <span className="material-symbols-outlined text-primary text-[20px]">
                            flight_land
                          </span>
                        </div>
                        <span className="font-label-md text-label-md text-primary">
                          {carrierName(rec.return_carrier)}
                        </span>
                      </div>
                      <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">
                        {(rec as any).return_duration_mins ? fmtDuration((rec as any).return_duration_mins) : ''}
                      </span>
                    </div>
                    <div className="flex justify-between items-end">
                      <div className="flex flex-col">
                        <div className="flex items-baseline gap-xs">
                          <span style={{
                            fontFamily: 'Newsreader, serif',
                            fontSize: 22,
                            fontWeight: 500,
                            color: '#191c1d',
                          }}>
                            {(rec as any).return_departure_time?.toString().slice(0,5) ?? ''}
                          </span>
                          <span className="text-on-surface-variant">–</span>
                          <span style={{
                            fontFamily: 'Newsreader, serif',
                            fontSize: 22,
                            fontWeight: 500,
                            color: '#191c1d',
                          }}>
                            {rec.return_arrival_time?.toString().slice(0,5) ?? ''}
                          </span>
                        </div>
                        <div className="flex gap-sm text-label-sm font-label-sm text-outline items-center">
                          <span>{(rec as any).ret_dest_iata ?? rec.out_dest_iata}</span>
                          <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                          <span>{rec.origin_iata}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-label-sm text-outline">
                          {fmtShortDate(rec.return_date)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Saving vs benchmark */}
              {aiSaving > 0 && (
                <div className="pt-md">
                  <div className="h-1 w-full bg-outline-variant/30 rounded-full overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: '100%' }} />
                  </div>
                  <p style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 12,
                    color: '#6f797a',
                    marginTop: 8,
                    textAlign: 'center',
                  }}>
                    £{Math.round(aiSaving)} below the typical booking
                  </p>
                </div>
              )}

              {/* Book buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <a
                  href={outboundUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full bg-primary text-on-primary py-md rounded-lg font-label-md text-label-md font-bold uppercase tracking-widest hover:opacity-90 transition-all shadow-md text-center block"
                >
                  {isSplit
                    ? `Book outbound · ${carrierName((rec as any)?.outbound_carrier ?? '')}`
                    : 'Book on Google Flights'}
                </a>
                {isSplit && (
                  <a
                    href={returnUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full border border-primary text-primary py-md rounded-lg font-label-md text-label-md font-bold uppercase tracking-widest hover:bg-primary/5 transition-all text-center block"
                  >
                    Book return · {carrierName((rec as any)?.return_carrier ?? '')}
                  </a>
                )}
              </div>

              {/* Email capture */}
              {!emailSent ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="email"
                    placeholder="Email me this recommendation"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '10px 14px',
                      border: '1px solid #bfc8c9',
                      borderRadius: 8,
                      fontSize: 13,
                      fontFamily: 'Inter, sans-serif',
                      outline: 'none',
                      color: '#191c1d',
                      background: '#ffffff',
                    }}
                  />
                  <button
                    onClick={() => { if (email.includes('@')) setEmailSent(true); }}
                    style={{
                      padding: '10px 16px',
                      background: '#fdba49',
                      color: '#191c1d',
                      border: 'none',
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      fontFamily: 'Inter, sans-serif',
                    }}
                  >
                    Send
                  </button>
                </div>
              ) : (
                <p style={{
                  fontSize: 13,
                  color: '#004349',
                  fontWeight: 500,
                  fontFamily: 'Inter, sans-serif',
                }}>
                  ✓ Recommendation sent — check your inbox.
                </p>
              )}

            </div>
            )} {/* end baseline ternary */}
          </div>

          {/* Right column notes */}
          {(earlyReturnNote || transitNote) && (
            <div className="flex flex-col gap-md mt-lg">
              {earlyReturnNote && (
                <div className="p-lg bg-surface-container-low rounded-xl border border-outline-variant/30 flex gap-md items-start">
                  <span className="material-symbols-outlined text-secondary">
                    schedule
                  </span>
                  <div>
                    <div className="font-label-sm text-label-sm font-bold uppercase text-secondary mb-1">
                      Early departure
                    </div>
                    <p className="font-body-md text-body-md text-on-surface-variant leading-tight">
                      {earlyReturnNote.insight}
                    </p>
                  </div>
                </div>
              )}
              {transitNote && (
                <div className="p-lg bg-surface-container-low rounded-xl border border-outline-variant/30 flex gap-md items-start">
                  <span className="material-symbols-outlined text-primary">
                    transfer_within_a_station
                  </span>
                  <div>
                    <div className="font-label-sm text-label-sm font-bold uppercase text-primary mb-1">
                      Getting home
                    </div>
                    <p className="font-body-md text-body-md text-on-surface-variant leading-tight">
                      {transitNote.insight}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Scenario Strip — what-if preference switcher */}
      {(() => {
        const scenariosWithInsights = (scenarios ?? []).map(s => ({
          ...s,
          facts: {
            ...s.facts,
            insight: aiResult?.scenario_insights?.find(
              si => si.lever === s.lever
            )?.insight ?? null,
          },
        }));
        return scenariosWithInsights.length > 0 ? (
          <ScenarioStrip
            scenarios={scenariosWithInsights}
            currentUrl={fetchParams.currentPageUrl ?? ''}
          />
        ) : null;
      })()}

      {/* Children (SavingsBreakdown, ComplianceCalculator, LegOptions, HSValueSummary) */}
      {children && (
        <div style={{ animation: 'fadeIn 0.4s ease' }}>
          {children}
        </div>
      )}
    </>
  );
}
