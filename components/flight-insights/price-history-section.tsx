'use client';

import { useEffect, useRef, useState } from 'react';
import { useFlightInsights } from './flight-insights-context';
import { PriceMovementChart } from './price-movement-chart';
import { buildPriceRangeLine, PRICE_MOVEMENT_STANDING_LINE } from '@/lib/flights/priceMovement';
import type { PricePoint, PriceMovementDirection, PricePositionTier } from '@/lib/flights/priceMovement';

// One compact card below the "Find your cheapest dates" matrix, toggling
// between destination-level median history and per-cell history (defaulting
// to the current recommendation). Same visual language, honesty rules, and
// data source pattern as the top-section price_movement card: cached
// derived tables only (never a live fare_snapshots scan), airfare only,
// neutral teal bars, no icon/colour implying direction, past-tense-only
// narration reusing the exact same system prompt (see lib/flights/priceMovement.ts).
//
// Closing line is deterministic (buildPriceRangeLine in priceMovement.ts),
// not AI-generated, and renders with identical structure and weight in
// every case — series low, series high, or neither. A prior version of
// this card (and the AI narration above it) only ever concluded something
// when the news favoured booking ("it's never been cheaper"), which is a
// structurally biased instrument regardless of how the sentence is worded.
// The standing "We don't predict where prices go next" line is likewise
// hardcoded and always present, never conditional on what the data shows.
//
// No auto-scroll — this card sits immediately below the matrix already, so
// it's in the viewport by the time the leg-options modal closes. Clicking a
// different cell or closing the modal switches the toggle to "These dates"
// and briefly highlights the card in place, without moving the page.

interface PriceHistoryResponse {
  checks_total: number;
  checks_with_data: number;
  price_points: PricePoint[];
  latest_total_gbp: number | null;
  previous_total_gbp: number | null;
  delta_gbp: number | null;
  direction: PriceMovementDirection;
  first_checked_on: string | null;
  is_current_lowest: boolean;
  range_low_gbp: number | null;
  range_high_gbp: number | null;
  price_position: PricePositionTier | null;
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

type View = 'cell' | 'destination';

const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtShort(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function humanizeDestination(slug: string): string {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    fontFamily: 'Inter, sans-serif',
    fontSize: 12,
    fontWeight: 600,
    padding: '5px 12px',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    background: active ? '#004349' : 'transparent',
    color: active ? '#ffffff' : '#3f484a',
  };
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

  const effectiveCell = selectedMatrixCell ?? (recommendation
    ? { outboundDate: recommendation.outbound_date, returnDate: recommendation.return_date }
    : null);

  const [view, setView] = useState<View>(() => (effectiveCell ? 'cell' : 'destination'));
  const [highlighted, setHighlighted] = useState(false);
  // Collapsed by default — the comparison table is the strongest evidence
  // on the page and stays visible; this chart-based section is secondary
  // and sits behind an expander instead.
  const [expanded, setExpanded] = useState(false);
  const isFirstCellRender = useRef(true);

  // Switch to "These dates", expand (if collapsed) and pulse whenever a
  // different cell is clicked — skip the pulse (but still land on the
  // right tab, still expand) for prefers-reduced-motion.
  useEffect(() => {
    if (!effectiveCell) return;
    if (isFirstCellRender.current) { isFirstCellRender.current = false; return; }
    setView('cell');
    setExpanded(true);
    if (prefersReducedMotion()) return;
    setHighlighted(true);
    const t = setTimeout(() => setHighlighted(false), 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveCell?.outboundDate, effectiveCell?.returnDate]);

  // Same treatment when the leg-options modal closes (X / outside click /
  // Esc — all routed through modalCloseCount), even if the cell didn't change.
  useEffect(() => {
    if (modalCloseCount === 0) return;
    setView('cell');
    setExpanded(true);
    if (prefersReducedMotion()) return;
    setHighlighted(true);
    const t = setTimeout(() => setHighlighted(false), 900);
    return () => clearTimeout(t);
  }, [modalCloseCount]);

  // Destination view — fetched once; destination/trip_type/composition don't
  // change without a full page navigation.
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

  // Cell view — defaults to the current recommendation's date pair until a
  // matrix cell is clicked (selectedMatrixCell, shared via context), then
  // re-fetches on every change.
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

  const showingCell = view === 'cell' && !!effectiveCell;
  const data = showingCell ? cellData : destinationData;
  const loading = showingCell ? cellLoading : destinationLoading;
  const subtitle = showingCell
    ? 'Airfare only — excludes bags, transit and transfers. The cheapest fare found for this exact date pair, which may be a different carrier or airport at each check.'
    : 'Airfare only — excludes bags, transit and transfers. The typical cheapest fare across every date on the grid above — not just one flight.';
  const fallbackText = showingCell
    ? 'Price history for this itinerary is not available right now.'
    : `Price history for ${destinationName} is not available right now.`;
  // Deterministic, unconditional closing line — see buildPriceRangeLine's
  // own comment for why this replaced the old AI-driven "never been
  // cheaper" takeaway.
  const rangeLine = data ? buildPriceRangeLine(data) : null;

  return (
    <section aria-label="Price history">
      {/* Same small-heading treatment as "How we chose these prices" above
          — both should read as intentional section headers, not one
          styled heading next to one floating paragraph. */}
      <h2 style={{
        fontFamily: 'Inter, sans-serif',
        fontSize: 13,
        fontWeight: 700,
        color: '#004349',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        margin: '0 0 8px',
      }}>
        Price history
      </h2>
      <p style={{
        fontFamily: 'Inter, sans-serif',
        fontSize: 14,
        color: '#6f797a',
        marginBottom: 12,
        maxWidth: '70ch',
      }}>
        We don't just check the price once — we keep watching. Here's how it's moved since we started.
      </p>

      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          fontFamily: 'Inter, sans-serif',
          fontSize: 14,
          fontWeight: 600,
          color: '#004349',
          background: 'none',
          border: 'none',
          padding: 0,
          marginBottom: expanded ? 12 : 0,
          cursor: 'pointer',
          textDecoration: 'underline',
          textUnderlineOffset: 2,
        }}
      >
        {expanded ? 'Hide the price history ↑' : 'See how the price has moved ↓'}
      </button>

      {expanded && (
      <div
        style={{
          background: highlighted ? '#f2f7f7' : '#ffffff',
          borderRadius: 16,
          boxShadow: highlighted
            ? '0 0 0 3px rgba(0,67,73,0.35), 0 2px 12px -2px rgba(13,92,99,0.08)'
            : '0 2px 12px -2px rgba(13,92,99,0.08)',
          padding: 18,
          transition: prefersReducedMotion() ? 'none' : 'box-shadow 0.4s ease, background 0.4s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
          <h3 style={{
            fontFamily: 'Newsreader, serif',
            fontSize: 18,
            fontWeight: 500,
            color: '#004349',
          }}>
            How the price has moved
          </h3>

          {effectiveCell && (
            <div role="tablist" aria-label="Price history view" style={{ display: 'flex', gap: 4, background: '#eef2f2', borderRadius: 8, padding: 3 }}>
              <button role="tab" aria-selected={view === 'cell'} onClick={() => setView('cell')} style={tabStyle(view === 'cell')}>
                These dates
              </button>
              <button role="tab" aria-selected={view === 'destination'} onClick={() => setView('destination')} style={tabStyle(view === 'destination')}>
                Whole matrix
              </button>
            </div>
          )}
        </div>

        {showingCell && effectiveCell && (
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, color: '#004349', marginBottom: 6 }}>
            {fmtShort(effectiveCell.outboundDate)} → {fmtShort(effectiveCell.returnDate)}
          </p>
        )}

        <p style={{
          fontFamily: 'Inter, sans-serif',
          fontSize: 12,
          color: '#6f797a',
          lineHeight: 1.5,
          marginBottom: 8,
          maxWidth: '70ch',
        }}>
          {subtitle}
        </p>

        {loading ? (
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#6f797a' }}>
            Loading price history…
          </p>
        ) : (
          <>
            <p style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: 14,
              color: '#3f484a',
              lineHeight: 1.5,
              maxWidth: '70ch',
            }}>
              {data?.narration || fallbackText}
            </p>
            {/* Unconditional — same structure and weight whether the
                current price is the series low, the series high, or
                neither. Never AI-generated. */}
            {rangeLine && (
              <p style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: 14,
                fontWeight: 600,
                color: '#004349',
                lineHeight: 1.5,
                marginTop: 4,
                maxWidth: '70ch',
              }}>
                {rangeLine}
              </p>
            )}
            {data && data.price_points.length > 1 && (
              <PriceMovementChart points={data.price_points} fullWidth compact />
            )}
          </>
        )}
        {/* Standing disclaimer — hardcoded, always present regardless of
            what the data shows, never conditional. */}
        <p style={{
          fontFamily: 'Inter, sans-serif',
          fontSize: 12,
          color: '#6f797a',
          marginTop: 8,
        }}>
          {PRICE_MOVEMENT_STANDING_LINE}
        </p>
      </div>
      )}
    </section>
  );
}
