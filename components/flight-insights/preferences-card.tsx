'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';

interface Props {
  cabinBags: number;
  checkedBags: number;
  seatsTogether: boolean;
  transitPreference: 'auto' | 'uber';
  postcodeDistrict: string | null;
  outboundCarrier?: string | null;
  adults?: number;
}

function Stepper({
  value, min = 0, max = 4, onChange,
}: { value: number; min?: number; max?: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
      <button
        onClick={() => value > min && onChange(value - 1)}
        disabled={value <= min}
        aria-label="Decrease"
        style={{
          width: 28, height: 28, borderRadius: 6, border: '1px solid #d1d8d9',
          background: 'none', color: value <= min ? '#bfc8c9' : '#004349',
          fontFamily: 'Inter, sans-serif', fontSize: 16, lineHeight: 1,
          cursor: value <= min ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        −
      </button>
      <span style={{
        fontFamily: 'Inter, sans-serif', fontSize: 20, fontWeight: 600,
        color: '#004349', minWidth: 20, textAlign: 'center',
      }}>
        {value}
      </span>
      <button
        onClick={() => value < max && onChange(value + 1)}
        disabled={value >= max}
        aria-label="Increase"
        style={{
          width: 28, height: 28, borderRadius: 6, border: '1px solid #d1d8d9',
          background: 'none', color: value >= max ? '#bfc8c9' : '#004349',
          fontFamily: 'Inter, sans-serif', fontSize: 16, lineHeight: 1,
          cursor: value >= max ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        +
      </button>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        marginTop: 10, width: 40, height: 22, borderRadius: 11, border: 'none',
        background: checked ? '#004349' : '#c4cccd', cursor: 'pointer',
        position: 'relative', transition: 'background 0.15s', flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: checked ? 20 : 2, width: 18, height: 18,
        borderRadius: 9, background: '#fff', transition: 'left 0.15s',
      }} />
    </button>
  );
}

export function PreferencesCard({ cabinBags, checkedBags, seatsTogether, transitPreference, postcodeDistrict, outboundCarrier, adults = 2 }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    function handleClick(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [expanded]);

  function update(key: string, val: string) {
    const p = new URLSearchParams(searchParams?.toString() ?? '');
    p.set(key, val);
    router.replace(`?${p.toString()}`);
  }

  const uberSub = `Estimate based on typical pricing from ${postcodeDistrict ?? 'your postcode district'}. XL vehicle assumed for parties of 4 or more.`;

  const TRANSIT_OPTIONS = [
    {
      val: 'auto' as const,
      label: 'Auto',
      sub: 'Public transport unless flight is before 07:00 or connections are impractical — then Uber',
    },
    {
      val: 'uber' as const,
      label: 'Always Uber',
      sub: uberSub,
    },
  ];

  const summaryParts = [
    `${cabinBags} cabin bag${cabinBags !== 1 ? 's' : ''}`,
    `${checkedBags} checked bag${checkedBags !== 1 ? 's' : ''}`,
    seatsTogether ? 'Seats reserved' : 'No seat selection',
    transitPreference === 'uber' ? 'Always Uber' : 'Auto transport',
  ];

  const label = { fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 700, color: '#191c1d' } as const;
  const sub   = { fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#6f797a', display: 'block', marginTop: 2 } as const;

  return (
    <div
      ref={cardRef}
      className="bg-white rounded-lg"
      style={{ padding: '16px 24px', boxShadow: '0 4px 12px rgba(13,92,99,0.08)' }}
    >
      {/* ── Collapsed row ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{
          fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600,
          color: '#004349', textTransform: 'uppercase', letterSpacing: '0.05em',
          flexShrink: 0,
        }}>
          Your trip preferences
        </span>
        <span style={{
          fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#6f797a',
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {summaryParts.join(' · ')}
        </span>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#004349',
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            flexShrink: 0, textDecoration: expanded ? 'underline' : 'none',
          }}
          onMouseEnter={(e: any) => (e.currentTarget.style.textDecoration = 'underline')}
          onMouseLeave={(e: any) => (e.currentTarget.style.textDecoration = expanded ? 'underline' : 'none')}
        >
          {expanded ? 'Done' : 'Edit'}
        </button>
      </div>

      {/* ── Expanded controls ───────────────────────────────────────────────── */}
      {expanded && (
        <div className="grid grid-cols-2 md:grid-cols-4" style={{ gap: 24, paddingTop: 16, marginTop: 16, borderTop: '1px solid #e2e8ea' }}>

          {/* Cabin bags */}
          <div>
            <span style={label}>Cabin bags</span>
            <span style={sub}>Overhead bags per leg · based on published airline fees</span>
            <Stepper value={cabinBags} onChange={v => update('cabin_bags', String(v))} />
          </div>

          {/* Checked bags */}
          <div>
            <span style={label}>Checked bags</span>
            <span style={sub}>Per leg · fees vary by route and demand for some airlines</span>
            <Stepper value={checkedBags} onChange={v => update('checked_bags', String(v))} />
          </div>

          {/* Pre-select seats */}
          <div>
            <span style={label}>Pre-select seats</span>
            <span style={sub}>
              {outboundCarrier === 'FR' && adults >= 2
                ? 'Ryanair charges a one-time £10 fee for the second adult. Toggle to include.'
                : outboundCarrier
                  ? `Optional — ${outboundCarrier === 'U2' ? 'easyJet' : outboundCarrier === 'W6' ? 'Wizz Air' : outboundCarrier === 'BA' ? 'British Airways' : outboundCarrier === 'VY' ? 'Vueling' : outboundCarrier === 'TP' ? 'TAP' : outboundCarrier} seats families together at no charge`
                  : 'Most airlines seat families together at no charge'}
            </span>
            <Toggle checked={seatsTogether} onChange={v => update('seats', v ? 'true' : 'false')} />
            {!seatsTogether && outboundCarrier === 'FR' && adults >= 2 && (
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#B45309', display: 'block', marginTop: 4 }}>
                Ryanair may not seat your family together without a paid reservation
              </span>
            )}
          </div>

          {/* Transit preference */}
          <div>
            <span style={label}>Getting to airport</span>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {TRANSIT_OPTIONS.map(opt => (
                <button
                  key={opt.val}
                  onClick={() => update('transit', opt.val)}
                  style={{
                    textAlign: 'left', padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
                    border: transitPreference === opt.val ? '1.5px solid #004349' : '1px solid #e2e8ea',
                    background: transitPreference === opt.val ? '#f0f7f8' : '#fff',
                  }}
                >
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, color: '#191c1d', display: 'block' }}>
                    {opt.label}
                  </span>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: '#6f797a', display: 'block', marginTop: 2, lineHeight: 1.4 }}>
                    {opt.sub}
                  </span>
                </button>
              ))}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
