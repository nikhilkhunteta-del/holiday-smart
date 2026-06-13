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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* Section header */}
      <div style={{ marginBottom: 16 }}>
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

      {/* Scenario items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {scenarios.map((scenario, i) => {
          const isAmber = scenario.saving > 0;
          const isLast  = i === scenarios.length - 1;
          const icon    = SCENARIO_ICONS[scenario.lever] ?? 'tune';

          return (
            <div
              key={i}
              className={`relative flex gap-lg pb-xl ${
                isLast ? 'hs-step-line-last' : 'hs-step-line'
              }`}
            >
              {/* Circle icon */}
              <div
                className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center text-white z-10"
                style={{
                  background: isAmber ? '#805600' : '#004349',
                  boxShadow:  '0 2px 12px -2px rgba(13,92,99,0.08)',
                }}
              >
                <span className="material-symbols-outlined">{icon}</span>
              </div>

              {/* Content */}
              <div className="flex-1">
                <h3 style={{
                  fontFamily:   'Newsreader, serif',
                  fontSize:     22,
                  fontWeight:   500,
                  color:        isAmber ? '#805600' : '#004349',
                  marginBottom: 8,
                  lineHeight:   1.4,
                }}>
                  {scenario.locked_headline}
                </h3>

                {/* Insight sentence */}
                {scenario.facts.insight && (
                  <p style={{
                    fontFamily:   'Inter, sans-serif',
                    fontSize:     16,
                    color:        '#3f484a',
                    lineHeight:   1.6,
                    marginBottom: 10,
                    maxWidth:     '42ch',
                  }}>
                    {scenario.facts.insight as string}
                  </p>
                )}

                {/* Cost delta */}
                <div style={{
                  display:       'flex',
                  alignItems:    'baseline',
                  gap:           10,
                  marginBottom:  8,
                }}>
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
                    marginBottom:  8,
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
                    fontSize:       13,
                    fontWeight:     600,
                    color:          '#004349',
                    textDecoration: 'none',
                    borderBottom:   '1px solid rgba(0,67,73,0.3)',
                    paddingBottom:  1,
                  }}
                >
                  Try this →
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
