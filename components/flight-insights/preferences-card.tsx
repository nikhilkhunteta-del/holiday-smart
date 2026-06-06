'use client';

import { useRouter, useSearchParams } from 'next/navigation';

interface Props {
  cabinBags: number;
  checkedBags: number;
  seatsTogether: boolean;
  transitPreference: 'auto' | 'uber';
  postcodeDistrict: string | null;
}

function Stepper({
  value, min = 0, max = 4, onChange,
}: { value: number; min?: number; max?: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <button
        onClick={() => value > min && onChange(value - 1)}
        disabled={value <= min}
        aria-label="Decrease"
        style={{
          width: 24, height: 24, borderRadius: '50%', border: '1px solid #d1d8d9',
          background: 'none', color: value <= min ? '#bfc8c9' : '#004349',
          fontFamily: 'Inter, sans-serif', fontSize: 14, lineHeight: 1,
          cursor: value <= min ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}
      >
        −
      </button>
      <span style={{
        fontFamily: 'Inter, sans-serif', fontSize: 16, fontWeight: 700,
        color: '#004349', minWidth: 16, textAlign: 'center',
      }}>
        {value}
      </span>
      <button
        onClick={() => value < max && onChange(value + 1)}
        disabled={value >= max}
        aria-label="Increase"
        style={{
          width: 24, height: 24, borderRadius: '50%', border: '1px solid #d1d8d9',
          background: 'none', color: value >= max ? '#bfc8c9' : '#004349',
          fontFamily: 'Inter, sans-serif', fontSize: 14, lineHeight: 1,
          cursor: value >= max ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
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
        marginTop: 6, width: 36, height: 20, borderRadius: 10, border: 'none',
        background: checked ? '#004349' : '#c4cccd', cursor: 'pointer',
        position: 'relative', transition: 'background 0.15s', flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: checked ? 18 : 2, width: 16, height: 16,
        borderRadius: 8, background: '#fff', transition: 'left 0.15s',
      }} />
    </button>
  );
}

const labelStyle = {
  fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 700,
  color: '#6f797a', textTransform: 'uppercase' as const, letterSpacing: '0.05em',
  display: 'block',
};

const subStyle = {
  fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#6f797a',
  display: 'block', marginTop: 2, marginBottom: 8, lineHeight: 1.4,
};

const divider = { borderBottom: '1px solid #e2e8ea', marginTop: 16, marginBottom: 16 };

export function PreferencesCard({ cabinBags, checkedBags, seatsTogether, transitPreference, postcodeDistrict }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function update(key: string, val: string) {
    const p = new URLSearchParams(searchParams?.toString() ?? '');
    p.set(key, val);
    router.replace(`?${p.toString()}`);
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
      sub: `Estimate based on typical pricing from ${postcodeDistrict ?? 'your postcode district'}. XL vehicle assumed for parties of 4 or more.`,
    },
  ];

  return (
    <div className="bg-white rounded-lg" style={{ padding: 20, boxShadow: '0 4px 12px rgba(13,92,99,0.08)' }}>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#004349', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>
        Preferences
      </p>

      <div>
        <span style={labelStyle}>Cabin bags</span>
        <span style={subStyle}>Overhead bags per leg</span>
        <Stepper value={cabinBags} onChange={v => update('cabin_bags', String(v))} />
      </div>

      <div style={divider} />

      <div>
        <span style={labelStyle}>Checked bags</span>
        <span style={subStyle}>Per leg · fees vary by route</span>
        <Stepper value={checkedBags} onChange={v => update('checked_bags', String(v))} />
      </div>

      <div style={divider} />

      <div>
        <span style={labelStyle}>Pre-select seats</span>
        <span style={subStyle}>Guarantees seats together · children free on Ryanair</span>
        <Toggle checked={seatsTogether} onChange={v => update('seats', v ? 'true' : 'false')} />
        {!seatsTogether && (
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#B45309', display: 'block', marginTop: 4 }}>
            Family split risk on most airlines
          </span>
        )}
      </div>

      <div style={divider} />

      <div>
        <span style={labelStyle}>Getting to airport</span>
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
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
  );
}
