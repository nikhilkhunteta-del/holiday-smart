'use client';

import { useEffect, useState } from 'react';
import { useFlightInsights } from './flight-insights-context';
import { PriceMovementChart } from './price-movement-chart';
import type { PricePoint, PriceMovementDirection } from '@/lib/flights/priceMovement';

// Two cards below the "Find your cheapest dates" matrix — destination-level
// median history (Card A) and per-cell history defaulting to the current
// recommendation (Card B). Same visual language, honesty rules, and data
// source pattern as the top-section price_movement card: cached derived
// tables only (never a live fare_snapshots scan), airfare only, neutral
// teal bars, no icon/colour implying direction, past-tense-only narration
// reusing the exact same system prompt (see lib/flights/priceMovement.ts).

interface PriceHistoryResponse {
  checks_total: number;
  checks_with_data: number;
  price_points: PricePoint[];
  latest_total_gbp: number | null;
  previous_total_gbp: number | null;
  delta_gbp: number | null;
  direction: PriceMovementDirection;
  narration: string;
}

interface PriceHistorySectionProps {
  destinationSlug: string;
  tripType: string;
  adults: number;
  children: number;
  infants: number;
  recommendation: { outbound_date: string; return_date: string } | null;
}

const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtShort(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function humanizeDestination(slug: string): string {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ── Shared card shell ────────────────────────────────────────────────────────

function PriceHistoryCard({
  heading, subtitle, aboveNarration, data, loading, fallbackText,
}: {
  heading: string;
  subtitle: string;
  aboveNarration?: string; // e.g. "Showing: Fri 30 Oct → Tue 3 Nov" for Card B
  data: PriceHistoryResponse | null;
  loading: boolean;
  fallbackText: string;
}) {
  return (
    <div style={{
      background: '#ffffff',
      borderRadius: 16,
      boxShadow: '0 2px 12px -2px rgba(13,92,99,0.08)',
      padding: 24,
      marginBottom: 24,
    }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div
          className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center text-white"
          style={{ background: '#004349' }}
        >
          <span className="material-symbols-outlined">query_stats</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{
            fontFamily: 'Newsreader, serif',
            fontSize: 22,
            fontWeight: 500,
            color: '#004349',
            marginBottom: 4,
            lineHeight: 1.4,
          }}>
            {heading}
          </h3>

          {aboveNarration && (
            <p style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: 13,
              fontWeight: 600,
              color: '#004349',
              marginBottom: 8,
            }}>
              {aboveNarration}
            </p>
          )}

          <p style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: 13,
            color: '#6f797a',
            lineHeight: 1.5,
            marginBottom: 8,
            maxWidth: '70ch',
          }}>
            {subtitle}
          </p>

          {loading ? (
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#6f797a' }}>
              Loading price history…
            </p>
          ) : (
            <>
              <p style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: 15,
                color: '#3f484a',
                lineHeight: 1.6,
                maxWidth: '70ch',
              }}>
                {data?.narration || fallbackText}
              </p>
              {data && data.price_points.length > 1 && (
                <PriceMovementChart points={data.price_points} fullWidth />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main section ─────────────────────────────────────────────────────────────

export function PriceHistorySection({
  destinationSlug, tripType, adults, children, infants, recommendation,
}: PriceHistorySectionProps) {
  const { selectedMatrixCell } = useFlightInsights();

  const [destinationData, setDestinationData] = useState<PriceHistoryResponse | null>(null);
  const [destinationLoading, setDestinationLoading] = useState(true);

  const [cellData, setCellData] = useState<PriceHistoryResponse | null>(null);
  const [cellLoading, setCellLoading] = useState(false);

  // Card A — fetched once; destination/trip_type/composition don't change
  // without a full page navigation.
  useEffect(() => {
    setDestinationLoading(true);
    const params = new URLSearchParams({
      destination_slug: destinationSlug,
      trip_type:        tripType,
      adults:           String(adults),
      children:         String(children),
      infants:          String(infants),
    });
    fetch(`/api/destination-price-history?${params}`)
      .then(r => r.json())
      .then(setDestinationData)
      .catch(err => console.error('[PriceHistorySection] destination fetch failed:', err))
      .finally(() => setDestinationLoading(false));
  }, [destinationSlug, tripType, adults, children, infants]);

  // Card B — defaults to the current recommendation's date pair until a
  // matrix cell is clicked (selectedMatrixCell, shared via context), then
  // re-fetches on every change.
  const effectiveCell = selectedMatrixCell ?? (recommendation
    ? { outboundDate: recommendation.outbound_date, returnDate: recommendation.return_date }
    : null);

  useEffect(() => {
    if (!effectiveCell) return;
    setCellLoading(true);
    const params = new URLSearchParams({
      destination_slug: destinationSlug,
      trip_type:        tripType,
      adults:           String(adults),
      children:         String(children),
      infants:          String(infants),
      departure_date:   effectiveCell.outboundDate,
      return_date:      effectiveCell.returnDate,
    });
    fetch(`/api/cell-price-history?${params}`)
      .then(r => r.json())
      .then(setCellData)
      .catch(err => console.error('[PriceHistorySection] cell fetch failed:', err))
      .finally(() => setCellLoading(false));
  }, [destinationSlug, tripType, adults, children, infants, effectiveCell?.outboundDate, effectiveCell?.returnDate]);

  const destinationName = humanizeDestination(destinationSlug);

  return (
    <section style={{ padding: 24 }} aria-label="Price history">
      {/* Framing line, not a duplicate heading — Card A's own heading
          already says "How {destination} prices have moved"; this explains
          why there are two cards rather than repeating that fact. */}
      <p style={{
        fontFamily: 'Inter, sans-serif',
        fontSize: 14,
        color: '#6f797a',
        marginBottom: 16,
        maxWidth: '70ch',
      }}>
        Two views of the same trend: how {destinationName} overall has moved, and how this specific date pair has moved.
      </p>

      <PriceHistoryCard
        heading={`How ${destinationName} prices have moved`}
        subtitle="Airfare only — excludes bags, transit and transfers. The typical cheapest fare across every date combination shown above."
        data={destinationData}
        loading={destinationLoading}
        fallbackText={`Price history for ${destinationName} is not available right now.`}
      />

      {effectiveCell && (
        <PriceHistoryCard
          heading="How this itinerary has moved"
          aboveNarration={`Showing: ${fmtShort(effectiveCell.outboundDate)} → ${fmtShort(effectiveCell.returnDate)}`}
          subtitle="Airfare only — excludes bags, transit and transfers."
          data={cellData}
          loading={cellLoading}
          fallbackText="Price history for this itinerary is not available right now."
        />
      )}
    </section>
  );
}
