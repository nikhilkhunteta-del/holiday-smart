import { Suspense } from 'react';
import type { AIRecommendationOutput } from '@/lib/flights/getAIRecommendation';

async function AIRecommendationInner({
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
      <p style={{
        fontFamily: 'Newsreader, serif',
        fontSize: 18,
        color: '#191c1d',
        lineHeight: 1.6,
        margin: 0,
      }}>
        {result.recommendation_prose}
      </p>
    </div>
  );
}

export function AIRecommendation({
  promise,
}: {
  promise: Promise<AIRecommendationOutput | null>;
}) {
  return (
    <Suspense fallback={
      <div style={{
        background: '#ffffff',
        borderRadius: 16,
        boxShadow: '0 2px 12px rgba(13,92,99,0.08)',
        padding: 24,
        height: 80,
        display: 'flex',
        alignItems: 'center',
      }}>
        <div
          className="animate-pulse"
          style={{
            width: '60%',
            height: 16,
            background: '#e1e3e3',
            borderRadius: 4,
          }}
        />
      </div>
    }>
      <AIRecommendationInner promise={promise} />
    </Suspense>
  );
}
