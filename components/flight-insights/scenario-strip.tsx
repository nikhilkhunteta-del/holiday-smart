'use client';

import type { ScenarioResult } from '@/lib/flights/computeScenarios';

interface ScenarioStripProps {
  scenarios:  ScenarioResult[];
  currentUrl: string;  // base URL without scenario params
}

const SCENARIO_ICONS: Record<string, string> = {
  travel_light:   'backpack',
  skip_seats:     'airline_seat_recline_normal',
  transport_flip: 'commute',
};

export function ScenarioStrip({ scenarios, currentUrl }: ScenarioStripProps) {
  if (!scenarios.length) return null;

  const buildUrl = (urlParams: Record<string, string>) => {
    const url = new URL(currentUrl, 'https://placeholder.com');
    Object.entries(urlParams).forEach(([k, v]) => {
      url.searchParams.set(k, v);
    });
    return url.pathname + '?' + url.searchParams.toString();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{
        fontFamily:      'Inter, sans-serif',
        fontSize:        11,
        fontWeight:      700,
        color:           '#004349',
        letterSpacing:   '0.06em',
        textTransform:   'uppercase',
      }}>
        What if you changed your preferences?
      </div>

      <div style={{
        display:               'grid',
        gridTemplateColumns:   'repeat(auto-fill, minmax(240px, 1fr))',
        gap:                   12,
      }}>
        {scenarios.map((scenario, i) => (
          <div
            key={i}
            style={{
              background:     '#ffffff',
              border:         '1px solid #e1e3e3',
              borderRadius:   12,
              padding:        '16px 18px',
              display:        'flex',
              flexDirection:  'column',
              gap:            10,
            }}
          >
            {/* Icon + headline */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width:           36,
                height:          36,
                borderRadius:    '50%',
                background:      'rgba(0,67,73,0.06)',
                display:         'flex',
                alignItems:      'center',
                justifyContent:  'center',
                flexShrink:      0,
              }}>
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 18, color: '#004349' }}
                >
                  {SCENARIO_ICONS[scenario.lever] ?? 'tune'}
                </span>
              </div>
              <div style={{
                fontFamily:  'Newsreader, serif',
                fontSize:    16,
                fontWeight:  500,
                color:       '#004349',
                lineHeight:  1.3,
              }}>
                {scenario.locked_headline}
              </div>
            </div>

            {/* Insight sentence */}
            {scenario.facts.insight && (
              <p style={{
                fontFamily: 'Inter, sans-serif',
                fontSize:   13,
                color:      '#3f484a',
                lineHeight: 1.5,
                margin:     0,
              }}>
                {scenario.facts.insight as string}
              </p>
            )}

            {/* Cost delta */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              {scenario.saving > 0 ? (
                <>
                  <span style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize:   15,
                    fontWeight: 700,
                    color:      '#004349',
                  }}>
                    Save £{scenario.saving}
                  </span>
                  <span style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize:   12,
                    color:      '#6f797a',
                  }}>
                    total: £{scenario.scenario_total}
                  </span>
                </>
              ) : scenario.saving < 0 ? (
                <>
                  <span style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize:   15,
                    fontWeight: 600,
                    color:      '#805600',
                  }}>
                    £{Math.abs(scenario.saving)} more
                  </span>
                  <span style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize:   12,
                    color:      '#6f797a',
                  }}>
                    total: £{scenario.scenario_total}
                  </span>
                </>
              ) : (
                <span style={{
                  fontFamily: 'Inter, sans-serif',
                  fontSize:   13,
                  color:      '#6f797a',
                }}>
                  Same total cost
                </span>
              )}
            </div>

            {/* Flight changes badge */}
            {scenario.flight_changes && (
              <div style={{
                fontFamily:    'Inter, sans-serif',
                fontSize:      11,
                color:         '#805600',
                fontWeight:    600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}>
                ↻ Different flight selected
              </div>
            )}

            {/* Try this link */}
            <a
              href={buildUrl(scenario.url_params)}
              style={{
                display:        'inline-flex',
                alignItems:     'center',
                gap:            4,
                fontFamily:     'Inter, sans-serif',
                fontSize:       12,
                fontWeight:     600,
                color:          '#004349',
                textDecoration: 'none',
                marginTop:      4,
              }}
            >
              Try this →
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
