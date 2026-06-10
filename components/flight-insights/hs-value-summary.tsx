'use client';

interface HSValueSummaryProps {
  saving: number;
  hasInsetDay: boolean;
  schoolName: string | null;
  outboundCarrier: string;
  returnCarrier: string;
  combinationCount: number;
}

export function HSValueSummary({
  saving,
  hasInsetDay,
  schoolName,
  outboundCarrier,
  returnCarrier,
  combinationCount,
}: HSValueSummaryProps) {
  const stats = [
    {
      icon: '🔍',
      value: `${combinationCount}+ combinations`,
      label: 'dates × airports × bags × seats × transport',
    },
    {
      icon: '💷',
      value: saving > 0 ? `£${Math.round(saving)} found` : 'Optimised trip',
      label: `${outboundCarrier} outbound · ${returnCarrier} return`,
    },
    {
      icon: '📅',
      value: hasInsetDay ? 'Extra day gained' : 'No absence needed',
      label: hasInsetDay
        ? `${schoolName ?? 'Your school'}'s inset day · zero fines`
        : 'Trip stays within term dates',
    },
    {
      icon: '✓',
      value: 'All-in pricing',
      label: 'Fare + bags + seats + transport — not just the headline fare',
    },
  ];

  return (
    <div style={{
      background: '#ffffff',
      borderRadius: 16,
      boxShadow: '0 2px 12px rgba(13,92,99,0.08)',
      padding: 24,
      fontFamily: 'Inter, sans-serif',
    }}>
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        color: '#004349',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        marginBottom: 20,
      }}>
        What Holiday Smart did for you
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: 16,
      }}>
        {stats.map((s, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 20 }}>{s.icon}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#191c1d' }}>
              {s.value}
            </div>
            <div style={{ fontSize: 12, color: '#6f797a', lineHeight: 1.4 }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
