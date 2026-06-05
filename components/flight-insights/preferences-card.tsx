'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

interface Props {
  cabinBags: number;
  checkedBags: number;
  seatsTogether: boolean;
  transitPreference: 'auto' | 'uber';
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

const TRANSIT_OPTIONS = [
  {
    val: 'auto' as const,
    label: 'Auto',
    sub: 'Public transport unless flight is before 07:00 or connections are impractical — then Uber',
  },
  {
    val: 'uber' as const,
    label: 'Always Uber',
    sub: 'Estimate based on typical pricing from your postcode district. XL vehicle assumed for parties of 4 or more.',
  },
];

export function PreferencesCard({ cabinBags, checkedBags, seatsTogether, transitPreference }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);

  function update(key: string, val: string) {
    setIsLoading(true);
    const p = new URLSearchParams(searchParams?.toString() ?? '');
    p.set(key, val);
    router.replace(`?${p.toString()}`);
  }

  const label = { fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 700, color: '#191c1d' } as const;
  const sub   = { fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#6f797a', display: 'block', marginTop: 2 } as const;

  return (
    <div className="bg-white rounded-lg" style={{ padding: 24, boxShadow: '0 4px 12px rgba(13,92,99,0.08)' }}>
      <p className="font-inter uppercase tracking-widest" style={{ fontSize: 11, color: '#004349', marginBottom: 16, fontWeight: 600 }}>
        Your trip preferences
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4">

        {/* Cabin bags */}
        <div className="pr-4 pb-5 md:pb-0 md:pr-5">
          <span style={label}>Cabin bags</span>
          <span style={sub}>Overhead bags per leg · based on published airline fees</span>
          <Stepper value={cabinBags} onChange={v => update('cabin_bags', String(v))} />
        </div>

        {/* Checked bags */}
        <div className="pl-4 pb-5 md:pb-0 md:px-5 md:border-l md:border-[#e2e8ea]">
          <span style={label}>Checked bags</span>
          <span style={sub}>Per leg · fees vary by route and demand for some airlines</span>
          <Stepper value={checkedBags} onChange={v => update('checked_bags', String(v))} />
        </div>

        {/* Pre-select seats */}
        <div className="pr-4 md:px-5 md:border-l md:border-[#e2e8ea]">
          <span style={label}>Pre-select seats</span>
          <span style={sub}>Guarantees seats together · children free on Ryanair</span>
          <Toggle checked={seatsTogether} onChange={v => update('seats', v ? 'true' : 'false')} />
          {!seatsTogether && (
            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#B45309', display: 'block', marginTop: 4 }}>
              Family split risk on most airlines
            </span>
          )}
        </div>

        {/* Transit preference */}
        <div className="pl-4 md:pl-5 md:border-l md:border-[#e2e8ea]">
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

      {isLoading && (
        <p className="font-inter" style={{ fontSize: 12, color: '#004349', marginTop: 12, fontWeight: 500 }}>
          Recalculating…
        </p>
      )}
    </div>
  );
}
