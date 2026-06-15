'use client';

import type { ScenarioResult } from '@/lib/flights/buildScenarioResults';

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Section header */}
      <div>
        <div style={{
          fontFamily:    'Inter, sans-serif',
          fontSize:      11,
          fontWeight:    700,
          color:         '#004349',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          marginBottom:  6,
        }}>
          Adjust and recalculate
        </div>
        <p style={{
          fontFamily: 'Inter, sans-serif',
          fontSize:   14,
          color:      '#6f797a',
          lineHeight: 1.5,
          margin:     0,
        }}>
          Change a preference and we'll find the best flight combination for
          that scenario — including if a different flight wins.
        </p>
      </div>

      {/* Horizontal card row */}
      <div style={{
        display:             'grid',
        gridTemplateColumns: `repeat(${scenarios.length}, 1fr)`,
        gap:                 16,
      }}>
        {scenarios.map((scenario, i) => {
          const isAmber = scenario.saving > 0;
          const icon    = SCENARIO_ICONS[scenario.lever] ?? 'tune';

          return (
            <div
              key={i}
              style={{
                background:    '#ffffff',
                borderRadius:  16,
                padding:       '20px 20px 16px',
                boxShadow:     '0 2px 12px rgba(13,92,99,0.08)',
                display:       'flex',
                flexDirection: 'column',
                gap:           10,
              }}
            >
              {/* Icon + headline */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width:          40,
                  height:         40,
                  borderRadius:   '50%',
                  background:     isAmber ? '#805600' : '#004349',
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'center',
                  flexShrink:     0,
                  boxShadow:      '0 2px 8px rgba(13,92,99,0.15)',
                }}>
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 20, color: '#ffffff' }}
                  >
                    {icon}
                  </span>
                </div>
                <h3 style={{
                  fontFamily: 'Newsreader, serif',
                  fontSize:   18,
                  fontWeight: 500,
                  color:      isAmber ? '#805600' : '#004349',
                  lineHeight: 1.3,
                  margin:     0,
                }}>
                  {scenario.locked_headline}
                </h3>
              </div>

              {/* Insight sentence */}
              {scenario.facts.insight && (
                <p style={{
                  fontFamily: 'Inter, sans-serif',
                  fontSize:   14,
                  color:      '#3f484a',
                  lineHeight: 1.5,
                  margin:     0,
                  flexGrow:   1,
                }}>
                  {scenario.facts.insight as string}
                </p>
              )}

              {/* Cost delta */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                {scenario.saving > 0 ? (
                  <>
                    <span style={{
                      fontFamily:    'Inter, sans-serif',
                      fontSize:      13,
                      fontWeight:    700,
                      color:         '#805600',
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
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
                      fontFamily:    'Inter, sans-serif',
                      fontSize:      13,
                      fontWeight:    600,
                      color:         '#6f797a',
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
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
                ) : null}
              </div>

              {/* Flight changes badge */}
              {scenario.flight_changes && (
                <div style={{
                  fontFamily:    'Inter, sans-serif',
                  fontSize:      11,
                  color:         '#004349',
                  fontWeight:    600,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}>
                  ↻ Different flight selected
                </div>
              )}

              {/* Divider */}
              <div style={{ height: 1, background: '#e1e3e3', margin: '4px 0' }} />

              {/* Try this link */}
              <a
                href={buildUrl(scenario.url_params)}
                style={{
                  display:        'inline-flex',
                  alignItems:     'center',
                  gap:            4,
                  fontFamily:     'Inter, sans-serif',
                  fontSize:       13,
                  fontWeight:     600,
                  color:          '#004349',
                  textDecoration: 'none',
                }}
              >
                Try this →
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
