'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { LegOptions, getCheapestOption } from './leg-options';
import { buildGoogleFlightsMultiLegUrl } from '@/lib/flights/googleFlightsUrl';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SelectedCell {
  outboundDate: string;
  returnDate: string;
  totalIncFine: number;
  fineGbp: number;
  requiresAbsence: boolean;
  label: string;
}

interface LegOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedCell: SelectedCell | null;
  destinationSlug: string;
  schoolUrn: string;
  adults: number;
  children: number;
  infants: number;
  cabinBags: number;
  checkedBags: number;
  seatsTogether: boolean;
  transportMode: string;
  postcodeDistrict: string;
  recommendation: {
    outbound_carrier: string; origin_iata: string; out_dest_iata: string;
    return_carrier: string; ret_dest_iata: string;
    outbound_date: string; return_date: string;
  } | null;
  // Real observed date (most recent checked_on in the same price_points
  // series that backs the booking box's "Fares observed" stamp and the
  // problem statement's "priced on" line) — not a separately-tracked
  // field, so it can't drift from those. null when no price history exists
  // yet, in which case the footnote drops the date clause entirely.
  observedDate?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function gbp(n: number): string {
  return `£${Math.round(Math.abs(n)).toLocaleString('en-GB')}`;
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function OptionsSkeleton() {
  return (
    <div style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Table header skeleton */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '52px 1fr 64px 84px 140px 80px 72px',
        gap: 8,
        padding: '8px 0 12px',
        borderBottom: '1px solid #bfc8c9',
        marginBottom: 4,
      }}>
        {['', '', 'Fare', 'Bags & seats', 'Transport', 'Dest.', 'Total'].map((h, i) => (
          <div key={i} style={{
            fontSize: 9, fontWeight: 600, color: '#6f797a',
            letterSpacing: '0.05em', textTransform: 'uppercase',
          }}>
            {h}
          </div>
        ))}
      </div>
      {/* Row skeletons */}
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          display: 'grid',
          gridTemplateColumns: '52px 1fr 64px 84px 140px 80px 72px',
          gap: 8,
          padding: '12px 0',
          borderBottom: i < 2 ? '1px solid #e8edee' : undefined,
        }}>
          <div style={{ width: 36, height: 36, borderRadius: 6, background: '#e1e3e3', animation: 'pulse 1.5s ease-in-out infinite' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
            <div style={{ height: 12, width: '70%', borderRadius: 4, background: '#e1e3e3' }} />
            <div style={{ height: 10, width: '50%', borderRadius: 4, background: '#eceeee' }} />
          </div>
          {[64, 84, 140, 80, 72].map((w, j) => (
            <div key={j} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ height: 13, width: w * 0.6, borderRadius: 4, background: '#e1e3e3' }} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function LegOptionsModal({
  isOpen,
  onClose,
  selectedCell,
  destinationSlug,
  schoolUrn,
  adults,
  children,
  infants,
  cabinBags,
  checkedBags,
  seatsTogether,
  transportMode,
  postcodeDistrict,
  recommendation,
  observedDate,
}: LegOptionsModalProps) {
  const [outboundData, setOutboundData] = useState<any>(null);
  const [returnData, setReturnData]     = useState<any>(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !selectedCell) return;

    setLoading(true);
    setError(null);
    setOutboundData(null);
    setReturnData(null);

    const params = new URLSearchParams({
      destination_slug: destinationSlug,
      school_urn:       schoolUrn,
      outbound_date:    selectedCell.outboundDate,
      return_date:      selectedCell.returnDate,
      adults:           String(adults),
      children:         String(children),
      infants:          String(infants),
      cabin_bags:       String(cabinBags),
      checked_bags:     String(checkedBags),
      seats_together:   String(seatsTogether),
      transport_mode:   transportMode,
    });

    fetch(`/api/leg-options?${params}`)
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.error ?? 'Failed to load options')))
      .then(data => {
        setOutboundData(data.outbound);
        setReturnData(data.return);
      })
      .catch(err => setError(typeof err === 'string' ? err : 'Failed to load options'))
      .finally(() => setLoading(false));
  }, [isOpen, selectedCell?.outboundDate, selectedCell?.returnDate]);

  const transitPreference = (transportMode === 'uber' ? 'uber' : transportMode === 'transit' ? 'transit' : 'auto') as 'auto' | 'uber' | 'transit';

  const outboundRec = recommendation ? {
    airline_iata:     recommendation.outbound_carrier,
    origin_iata:      recommendation.origin_iata,
    destination_iata: recommendation.out_dest_iata,
    departure_time:   '',
  } : null;
  const returnRec = recommendation ? {
    airline_iata:     recommendation.return_carrier,
    origin_iata:      recommendation.out_dest_iata,
    destination_iata: recommendation.ret_dest_iata,
    departure_time:   '',
  } : null;

  // ── "Book these dates" — the cheapest outbound + cheapest return option
  // shown in this modal (the same rows LegOptions itself badges CHEAPEST),
  // not the matrix's own cellMap-selected combination — see CLAUDE.md
  // "Known Issues" for why those two aren't guaranteed to be the same
  // total. Hidden entirely when the clicked cell already IS the current
  // recommendation, since that combination is already bookable from the
  // top-section booking box.
  const cheapestOutbound = getCheapestOption(outboundData);
  const cheapestReturn   = getCheapestOption(returnData);

  const isCurrentRecommendation = !!(
    recommendation && selectedCell &&
    recommendation.outbound_date === selectedCell.outboundDate &&
    recommendation.return_date   === selectedCell.returnDate
  );

  const showBookButton = !isCurrentRecommendation && !!cheapestOutbound && !!cheapestReturn && !!selectedCell;

  // Built from each leg's own airports, not assumed symmetric — the
  // cheapest outbound and cheapest return can use different abroad
  // airports (e.g. Barcelona: BCN out, GRO back) via nearby-airport
  // arbitrage, same reason get_smart_recommendation exposes ret_orig_iata
  // separately rather than assuming it equals out_dest_iata.
  const bookUrl = showBookButton
    ? buildGoogleFlightsMultiLegUrl([
        { origin: cheapestOutbound!.origin_iata, dest: cheapestOutbound!.destination_iata, date: selectedCell!.outboundDate },
        { origin: cheapestReturn!.origin_iata,   dest: cheapestReturn!.destination_iata,   date: selectedCell!.returnDate },
      ])
    : null;

  return (
    <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent
        className="max-w-3xl w-full p-0 overflow-hidden"
        style={{
          background: '#f8fafa',
          borderRadius: 16,
          boxShadow: '0 16px 48px rgba(13,92,99,0.14)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Visually hidden title for accessibility */}
        <DialogTitle className="sr-only">
          Flight options for {selectedCell ? `${fmtDate(selectedCell.outboundDate)} → ${fmtDate(selectedCell.returnDate)}` : 'selected dates'}
        </DialogTitle>

        {/* ── Header ── */}
        <div style={{
          background: '#ffffff',
          padding: '24px 24px 20px',
          borderBottom: '1px solid #e6e8e8',
          flexShrink: 0,
        }}>
          {selectedCell && (
            <>
              <div style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: 22,
                fontWeight: 500,
                color: '#004349',
                lineHeight: 1.3,
                marginBottom: 6,
              }}>
                {fmtDate(selectedCell.outboundDate)} → {fmtDate(selectedCell.returnDate)}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{
                  fontFamily: 'Inter, sans-serif',
                  fontSize: 20,
                  fontWeight: 700,
                  color: '#004349',
                }}>
                  {gbp(selectedCell.totalIncFine)} all-in
                </span>

                {selectedCell.fineGbp > 0 && (
                  <span style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#5c310d',
                    background: '#fdba49',
                    borderRadius: 9999,
                    padding: '3px 10px',
                  }}>
                    Includes {gbp(selectedCell.fineGbp)} fine estimate
                  </span>
                )}
              </div>

              {/* ── 5. Context line ── */}
              <p style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: 14,
                color: '#3f484a',
                marginTop: 4,
                marginBottom: 0,
              }}>
                Cheapest all-in combination for these dates
              </p>

              {showBookButton && bookUrl && (
                <div style={{ marginTop: 12 }}>
                  <a
                    href={bookUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-block',
                      background: '#004349',
                      color: '#ffffff',
                      fontFamily: 'Inter, sans-serif',
                      fontSize: 13,
                      fontWeight: 600,
                      padding: '8px 16px',
                      borderRadius: 8,
                      textDecoration: 'none',
                    }}
                  >
                    Book these dates
                  </a>
                  <p style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 11,
                    color: '#6f797a',
                    marginTop: 6,
                    marginBottom: 0,
                  }}>
                    Opens Google Flights for these dates — confirm the airline and price match before booking.
                  </p>
                </div>
              )}

              {selectedCell.requiresAbsence && (
                <p style={{
                  fontFamily: 'Inter, sans-serif',
                  fontSize: 11,
                  color: '#6f797a',
                  marginTop: 6,
                  marginBottom: 0,
                }}>
                  This combination includes term-time absence. Schools apply penalty notices inconsistently. We don't recommend unauthorised absence — this is shown so you can decide.
                </p>
              )}
            </>
          )}
        </div>

        {/* ── Tabs ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 0' }}>
          <Tabs defaultValue="outbound">
            <TabsList style={{
              background: '#e1e3e3',
              borderRadius: 10,
              padding: 3,
              marginBottom: 16,
              height: 'auto',
            }}>
              <TabsTrigger
                value="outbound"
                style={{ borderRadius: 8, fontFamily: 'Inter, sans-serif', fontSize: 13 }}
              >
                Outbound{selectedCell ? ` · ${fmtDate(selectedCell.outboundDate)}` : ''}
              </TabsTrigger>
              <TabsTrigger
                value="return"
                style={{ borderRadius: 8, fontFamily: 'Inter, sans-serif', fontSize: 13 }}
              >
                Return{selectedCell ? ` · ${fmtDate(selectedCell.returnDate)}` : ''}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="outbound">
              {loading && <OptionsSkeleton />}
              {error && <ErrorState message={error} onRetry={() => {
                setError(null);
                setLoading(true);
              }} />}
              {!loading && !error && outboundData && (
                <LegOptions
                  data={outboundData}
                  title={`Outbound options · ${selectedCell ? fmtDate(selectedCell.outboundDate) : ''}`}
                  adults={adults}
                  children={children}
                  infants={infants}
                  transitPreference={transitPreference}
                  postcodeDistrict={postcodeDistrict}
                  selectedDate={selectedCell?.outboundDate ?? ''}
                  smartDate={selectedCell?.outboundDate ?? ''}
                  recommendedOption={outboundRec}
                />
              )}
            </TabsContent>

            <TabsContent value="return">
              {loading && <OptionsSkeleton />}
              {error && <ErrorState message={error} onRetry={() => {
                setError(null);
                setLoading(true);
              }} />}
              {!loading && !error && returnData && (
                <LegOptions
                  data={returnData}
                  title={`Return options · ${selectedCell ? fmtDate(selectedCell.returnDate) : ''}`}
                  adults={adults}
                  children={children}
                  infants={infants}
                  transitPreference={transitPreference}
                  postcodeDistrict={postcodeDistrict}
                  selectedDate={selectedCell?.returnDate ?? ''}
                  smartDate={selectedCell?.returnDate ?? ''}
                  recommendedOption={returnRec}
                />
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* ── Footer ── */}
        <div style={{
          padding: '12px 24px 20px',
          borderTop: '1px solid #e6e8e8',
          flexShrink: 0,
        }}>
          <p style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: 10,
            color: '#6f797a',
            margin: 0,
            lineHeight: 1.5,
          }}>
            {observedDate
              ? `Fares are live prices observed ${fmtDate(observedDate)}. Bag fees, airport transport and fine amounts are estimates from published rates.`
              : 'Fares are live prices. Bag fees, airport transport and fine amounts are estimates from published rates.'}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Error state ────────────────────────────────────────────────────────────────

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{
      padding: '24px 0',
      textAlign: 'center',
      fontFamily: 'Inter, sans-serif',
    }}>
      <p style={{ fontSize: 13, color: '#6f797a', marginBottom: 12 }}>{message}</p>
      <button
        onClick={onRetry}
        style={{
          fontFamily: 'Inter, sans-serif',
          fontSize: 13,
          fontWeight: 600,
          color: '#004349',
          background: 'none',
          border: '1.5px solid #004349',
          borderRadius: 8,
          padding: '6px 16px',
          cursor: 'pointer',
        }}
      >
        Retry
      </button>
    </div>
  );
}
