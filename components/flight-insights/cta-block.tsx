'use client';

import { useState } from 'react';
import { useFlightInsights } from './flight-insights-context';

function buildGoogleFlightsUrl(params: {
  origin: string;
  destination: string;
  date: string;
  adults: number;
  children: number;
}): string {
  // Google Flights URL format
  return `https://www.google.com/travel/flights?q=Flights+from+${params.origin}+to+${params.destination}+on+${params.date}&adults=${params.adults}&children=${params.children}`;
}

interface CTABlockProps {
  adults: number;
  children: number;
  // Fallback dates/routes if AI hasn't resolved
  fallbackOutboundDate: string;
  fallbackReturnDate: string;
  fallbackOrigin: string;
  fallbackOutDest: string;
}

export function CTABlock({
  adults,
  children,
  fallbackOutboundDate,
  fallbackReturnDate,
  fallbackOrigin,
  fallbackOutDest,
}: CTABlockProps) {
  const { aiResult } = useFlightInsights();
  const [emailSent, setEmailSent] = useState(false);
  const [email, setEmail] = useState('');
  const [diyOpen, setDiyOpen] = useState(false);

  const rec = aiResult?.recommendedCombination;

  const outboundDate   = rec?.outbound_date   ?? fallbackOutboundDate;
  const returnDate     = rec?.return_date     ?? fallbackReturnDate;
  const origin         = rec?.origin_iata     ?? fallbackOrigin;
  const outDest        = rec?.out_dest_iata   ?? fallbackOutDest;
  const retDest        = rec?.ret_dest_iata   ?? origin;
  const outCarrier     = rec?.outbound_carrier ?? '';
  const retCarrier     = rec?.return_carrier   ?? '';
  const isSplitCarrier = rec?.split_carrier   ?? false;

  const outboundUrl = buildGoogleFlightsUrl({
    origin,
    destination: outDest,
    date: outboundDate,
    adults,
    children,
  });

  const returnUrl = buildGoogleFlightsUrl({
    origin: outDest,
    destination: retDest,
    date: returnDate,
    adults,
    children,
  });

  function formatDate(iso: string): string {
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const d = new Date(iso + 'T00:00:00');
    return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  }

  const carrierNames: Record<string, string> = {
    BA: 'British Airways', FR: 'Ryanair', U2: 'easyJet',
    W6: 'Wizz Air', VY: 'Vueling', TP: 'TAP Air Portugal',
  };

  return (
    <div style={{
      background: '#ffffff',
      borderRadius: 16,
      boxShadow: '0 2px 12px rgba(13,92,99,0.08)',
      padding: 24,
      fontFamily: 'Inter, sans-serif',
    }}>
      <div style={{
        fontSize: 16,
        fontWeight: 600,
        color: '#004349',
        marginBottom: 4,
      }}>
        Ready to book?
      </div>
      <div style={{
        fontSize: 13,
        color: '#6f797a',
        marginBottom: 20,
        lineHeight: 1.5,
      }}>
        {isSplitCarrier
          ? 'This trip uses two airlines — book each leg separately.'
          : 'Book directly with the airline.'}
      </div>

      {/* Booking buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        <a
          href={outboundUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            background: '#004349',
            color: '#ffffff',
            borderRadius: 10,
            textDecoration: 'none',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          <span>
            {outCarrier ? `${carrierNames[outCarrier] ?? outCarrier} · ` : ''}
            {origin} → {outDest} · {formatDate(outboundDate)}
          </span>
          <span style={{ fontSize: 12, opacity: 0.8 }}>Search on Google Flights →</span>
        </a>

        {isSplitCarrier && (
          <a
            href={returnUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              background: '#004349',
              color: '#ffffff',
              borderRadius: 10,
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            <span>
              {retCarrier ? `${carrierNames[retCarrier] ?? retCarrier} · ` : ''}
              {outDest} → {retDest} · {formatDate(returnDate)}
            </span>
            <span style={{ fontSize: 12, opacity: 0.8 }}>Search on Google Flights →</span>
          </a>
        )}

        {!isSplitCarrier && (
          <a
            href={returnUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              border: '1px solid #004349',
              color: '#004349',
              borderRadius: 10,
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: 600,
              background: 'transparent',
            }}
          >
            <span>
              {outDest} → {retDest} · {formatDate(returnDate)}
            </span>
            <span style={{ fontSize: 12, opacity: 0.6 }}>Return leg →</span>
          </a>
        )}
      </div>

      {/* Email capture */}
      {!emailSent ? (
        <div style={{
          display: 'flex',
          gap: 8,
          marginBottom: 16,
        }}>
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
            }}
          />
          <button
            onClick={() => {
              if (email.includes('@')) setEmailSent(true);
            }}
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
            }}
          >
            Send
          </button>
        </div>
      ) : (
        <div style={{
          fontSize: 13,
          color: '#004349',
          marginBottom: 16,
          fontWeight: 500,
        }}>
          ✓ Recommendation sent — check your inbox.
        </div>
      )}

      {/* DIY instructions */}
      <button
        onClick={() => setDiyOpen(v => !v)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          fontSize: 13,
          color: '#6f797a',
          textDecoration: 'underline',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        {diyOpen ? '− Hide' : '+ How to book this yourself'}
      </button>

      {diyOpen && rec && (
        <div style={{
          marginTop: 16,
          padding: 16,
          background: '#f8fafa',
          borderRadius: 10,
          fontSize: 13,
          color: '#3f484a',
          lineHeight: 1.8,
        }}>
          <div style={{ marginBottom: 8, fontWeight: 600, color: '#191c1d' }}>
            Step by step:
          </div>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            <li>
              Go to <strong>{carrierNames[outCarrier] ?? outCarrier}</strong> — search {origin}→{outDest},{' '}
              {formatDate(outboundDate)}, {adults} adult{adults > 1 ? 's' : ''},
              {children > 0 ? ` ${children} child${children > 1 ? 'ren' : ''}` : ''}, one-way.
              {rec.outbound_departure_time ? ` Select the ${rec.outbound_departure_time} flight.` : ''}
              {rec.seat_cost_gbp > 0 ? ' Add seats together.' : ''}
            </li>
            {isSplitCarrier && (
              <li>
                Go to <strong>{carrierNames[retCarrier] ?? retCarrier}</strong> — search {outDest}→{retDest},{' '}
                {formatDate(returnDate)}, same passengers, one-way.
                {rec.return_arrival_time ? ` Select the flight arriving ${rec.return_arrival_time}.` : ''}
                {rec.cabin_bag_cost_gbp > 0 ? ' Add cabin bags.' : ''}
              </li>
            )}
            {!isSplitCarrier && (
              <li>
                Return leg: {outDest}→{retDest}, {formatDate(returnDate)}.
                {rec.return_arrival_time ? ` Arrives ${rec.return_arrival_time}.` : ''}
              </li>
            )}
            <li>
              Transport to {origin}: {rec.outbound_transit?.transit?.route_summary
                ? `${rec.outbound_transit.transit.route_summary} (${rec.outbound_transit.transit.duration_mins} mins)`
                : 'check Google Maps for directions'}.
            </li>
          </ol>
          <div style={{ marginTop: 12, fontSize: 12, color: '#6f797a' }}>
            Prices observed recently. Verify on airline websites before booking.
          </div>
        </div>
      )}
    </div>
  );
}
