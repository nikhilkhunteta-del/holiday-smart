'use client';

import { useEffect, useRef } from 'react';
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
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function NarrativeSkeleton() {
  return (
    <div style={{
      background: '#ffffff',
      borderRadius: 16,
      boxShadow: '0 2px 12px rgba(13,92,99,0.08)',
      padding: 24,
    }}>
      <style>{`
        @keyframes shimmer {
          0% { opacity: 1; }
          50% { opacity: 0.4; }
          100% { opacity: 1; }
        }
        .skeleton-line {
          background: #e1e3e3;
          border-radius: 4px;
          animation: shimmer 1.5s ease-in-out infinite;
        }
      `}</style>
      {/* Prose skeleton */}
      <div style={{ marginBottom: 20 }}>
        {[100, 90, 65].map((w, i) => (
          <div
            key={i}
            className="skeleton-line"
            style={{ height: 14, width: `${w}%`, marginBottom: 8 }}
          />
        ))}
      </div>
      {/* Card skeletons */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 12,
      }}>
        {[1, 2, 3].map(i => (
          <div
            key={i}
            className="skeleton-line"
            style={{ height: 80, borderRadius: 12 }}
          />
        ))}
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

export function AIRecommendationClient({ fetchParams }: AIRecommendationClientProps) {
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
      .then(data => setAIResult(data))
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

  if (aiLoading && !aiResult) return <NarrativeSkeleton />;
  if (!aiResult || aiResult.fallback) return null;

  return (
    <div style={{
      background: '#ffffff',
      borderRadius: 16,
      boxShadow: '0 2px 12px rgba(13,92,99,0.08)',
      padding: 24,
      fontFamily: 'Inter, sans-serif',
    }}>
      {/* Headline + subheadline */}
      {aiResult.headline && (
        <p style={{
          fontFamily: 'Newsreader, serif',
          fontSize: 22,
          fontWeight: 600,
          color: '#191c1d',
          lineHeight: 1.4,
          margin: '0 0 8px',
        }}>
          {aiResult.headline}
        </p>
      )}
      {aiResult.subheadline && (
        <p style={{
          fontFamily: 'Inter, sans-serif',
          fontSize: 14,
          color: '#6f797a',
          lineHeight: 1.5,
          margin: '0 0 16px',
        }}>
          {aiResult.subheadline}
        </p>
      )}
      {/* Prose */}
      {aiResult.recommendation_prose && (
        <p style={{
          fontFamily: 'Newsreader, serif',
          fontSize: 18,
          color: '#191c1d',
          lineHeight: 1.7,
          margin: '0 0 24px',
        }}>
          {aiResult.recommendation_prose}
        </p>
      )}
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
  );
}
