import { Suspense } from 'react';
import type { AIRecommendationOutput } from '@/lib/flights/getAIRecommendation';

// ── Skeleton ──────────────────────────────────────────────────────────────────

function NarrativeSkeleton() {
  return (
    <div style={{
      background: '#ffffff',
      borderRadius: 16,
      boxShadow: '0 2px 12px rgba(13,92,99,0.08)',
      padding: 24,
    }}>
      <div style={{ marginBottom: 20 }}>
        {[100, 85, 60].map((w, i) => (
          <div key={i} style={{
            height: 14,
            width: `${w}%`,
            background: '#e1e3e3',
            borderRadius: 4,
            marginBottom: 8,
          }} className="animate-pulse" />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{
            height: 80,
            background: '#f2f4f4',
            borderRadius: 12,
          }} className="animate-pulse" />
        ))}
      </div>
    </div>
  );
}

// ── Prose block ───────────────────────────────────────────────────────────────

function RecommendationProse({ prose }: { prose: string }) {
  return (
    <p style={{
      fontFamily: 'Newsreader, serif',
      fontSize: 18,
      color: '#191c1d',
      lineHeight: 1.7,
      margin: '0 0 24px',
    }}>
      {prose}
    </p>
  );
}

// ── Lever card ────────────────────────────────────────────────────────────────

const LEVER_COLOURS: Record<string, string> = {
  inset_day:                  '#004349',
  absence_tradeoff:           '#805600',
  departure_airport:          '#004349',
  outbound_arrival_airport:   '#004349',
  return_arrival_airport:     '#004349',
  travel_light:               '#805600',
  checked_bags:               '#805600',
  transport_outbound:         '#3f484a',
  transport_return:           '#3f484a',
  split_carrier:              '#3f484a',
  family_split_risk:          '#ba1a1a',
  bags_estimate:              '#6f797a',
};

function LeverCard({ insight }: { insight: AIRecommendationOutput['lever_insights'][0] }) {
  const colour = LEVER_COLOURS[insight.lever] ?? '#3f484a';
  return (
    <div style={{
      background: '#f8fafa',
      border: '1px solid #e1e3e3',
      borderRadius: 12,
      padding: '14px 16px',
    }}>
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        color: colour,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        marginBottom: 6,
      }}>
        {insight.headline ?? insight.lever.replace(/_/g, ' ')}
      </div>
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

// ── Inner component (awaits the promise) ─────────────────────────────────────

async function AINarrativeInner({
  promise,
}: {
  promise: Promise<AIRecommendationOutput | null>;
}) {
  const result = await promise;
  if (!result || result.fallback) return null;

  return (
    <div style={{
      background: '#ffffff',
      borderRadius: 16,
      boxShadow: '0 2px 12px rgba(13,92,99,0.08)',
      padding: 24,
      fontFamily: 'Inter, sans-serif',
    }}>
      {result.recommendation_prose && (
        <RecommendationProse prose={result.recommendation_prose} />
      )}
      {result.lever_insights.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 12,
        }}>
          {result.lever_insights.map((insight, i) => (
            <LeverCard key={i} insight={insight} />
          ))}
        </div>
      )}
      {result.caveats.length > 0 && (
        <div style={{
          marginTop: 16,
          fontSize: 12,
          color: '#6f797a',
          lineHeight: 1.5,
        }}>
          {result.caveats.map((c, i) => (
            <p key={i} style={{ margin: '2px 0' }}>* {c}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Public export (wraps in Suspense) ─────────────────────────────────────────

export function AINarrative({
  promise,
}: {
  promise: Promise<AIRecommendationOutput | null>;
}) {
  return (
    <Suspense fallback={<NarrativeSkeleton />}>
      <AINarrativeInner promise={promise} />
    </Suspense>
  );
}
