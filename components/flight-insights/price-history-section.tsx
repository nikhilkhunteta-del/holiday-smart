'use client';

import { useEffect, useRef, useState } from 'react';
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
  heading, subtitle, aboveNarration, data, loading, fallbackText, highlighted, innerRef,
}: {
  heading: string;
  subtitle: string;
  aboveNarration?: string; // e.g. "Showing: Fri 30 Oct → Tue 3 Nov" for Card B
  data: PriceHistoryResponse | null;
  loading: boolean;
  fallbackText: string;
  highlighted?: boolean; // brief pulse after the leg-options modal closes
  innerRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={innerRef}
      style={{
        background: highlighted ? '#f2f7f7' : '#ffffff',
        borderRadius: 16,
        boxShadow: highlighted
          ? '0 0 0 3px rgba(0,67,73,0.35), 0 2px 12px -2px rgba(13,92,99,0.08)'
          : '0 2px 12px -2px rgba(13,92,99,0.08)',
        padding: 24,
        marginBottom: 24,
        transition: 'box-shadow 0.4s ease, background 0.4s ease',
      }}
    >
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
  const { selectedMatrixCell, modalCloseCount } = useFlightInsights();

  const [destinationData, setDestinationData] = useState<PriceHistoryResponse | null>(null);
  const [destinationLoading, setDestinationLoading] = useState(true);

  const [cellData, setCellData] = useState<PriceHistoryResponse | null>(null);
  const [cellLoading, setCellLoading] = useState(false);

  // Auto-scroll + highlight the itinerary card when the leg-options modal
  // closes (X / outside click / Esc — all routed through modalCloseCount).
  // First-time-only per page visit: subsequent cell clicks update the
  // chart in place without yanking the page around again.
  const itineraryCardRef = useRef<HTMLDivElement>(null);
  const hasAutoScrolledRef = useRef(false);
  const [itineraryHighlighted, setItineraryHighlighted] = useState(false);

  useEffect(() => {
    if (modalCloseCount === 0) return; // no close has happened yet
    if (hasAutoScrolledRef.current) return; // first-time-only
    hasAutoScrolledRef.current = true;

    itineraryCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setItineraryHighlighted(true);
    const t = setTimeout(() => setItineraryHighlighted(false), 1000);
    return () => clearTimeout(t);
  }, [modalCloseCount]);

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
          why there are two cards rather than repeating that fact. Ordered
          to match the cards below: itinerary first, destination second. */}
      <p style={{
        fontFamily: 'Inter, sans-serif',
        fontSize: 14,
        color: '#6f797a',
        marginBottom: 16,
        maxWidth: '70ch',
      }}>
        Two views of the same trend: how this specific date pair has moved, and how {destinationName} overall has moved.
      </p>

      {effectiveCell && (
        <PriceHistoryCard
          innerRef={itineraryCardRef}
          highlighted={itineraryHighlighted}
          heading="How this itinerary has moved"
          aboveNarration={`Showing: ${fmtShort(effectiveCell.outboundDate)} → ${fmtShort(effectiveCell.returnDate)}`}
          subtitle="Airfare only — excludes bags, transit and transfers. This is the cheapest fare found for this exact date pair — not a median."
          data={cellData}
          loading={cellLoading}
          fallbackText="Price history for this itinerary is not available right now."
        />
      )}

      <PriceHistoryCard
        heading={`How ${destinationName} prices have moved`}
        subtitle="Airfare only — excludes bags, transit and transfers. This is the median of the cheapest fare across every date pair on the matrix above — not this specific itinerary."
        data={destinationData}
        loading={destinationLoading}
        fallbackText={`Price history for ${destinationName} is not available right now.`}
      />
    </section>
  );
}
