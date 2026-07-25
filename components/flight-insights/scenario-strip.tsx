'use client';

import type { ReactNode } from 'react';
import type { ScenarioResult } from '@/lib/flights/buildScenarioResults';

interface ScenarioStripProps {
  scenarios:  ScenarioResult[];
  currentUrl: string;  // base URL without scenario params
}

const SCENARIO_ICONS: Record<string, string> = {
  travel_light:          'backpack',
  skip_seats:            'airline_seat_recline_normal',
  transport_flip:        'commute',
  transport_all_transit: 'directions_bus',
  add_checked_bag:       'luggage',
};

// DESIGN.md: Newsreader for editorial voice, Inter for data — the £ figures
// baked into locked_headline ("Add checked bag — £118 more") switch to
// Inter, the rest inherits the h3's Newsreader. Scoped to £-amounts only.
function withInterNumerals(text: string): ReactNode {
  const parts = text.split(/(£[\d,]+(?:\.\d+)?)/g);
  return parts.map((part, i) =>
    /^£[\d,]+(?:\.\d+)?$/.test(part)
      ? <span key={i} style={{ fontFamily: 'Inter, sans-serif' }}>{part}</span>
      : part
  );
}

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
          const icon = SCENARIO_ICONS[scenario.lever] ?? 'tune';

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
              {/* Icon + headline — icon colour is uniform teal across every
                  card (previously amber/teal split on scenario.saving with
                  no consistent logic; amber is reserved for CTAs). Headline
                  block has a fixed min-height so a 2-line wrap on one card
                  doesn't leave that card's content sitting lower than its
                  1-line siblings. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width:          40,
                  height:         40,
                  borderRadius:   '50%',
                  background:     '#004349',
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
                  color:      '#004349',
                  lineHeight: 1.3,
                  margin:     0,
                  minHeight:  '2.6em',
                  display:    'flex',
                  alignItems: 'center',
                }}>
                  {withInterNumerals(scenario.locked_headline)}
                </h3>
              </div>

              {/* Insight sentence — no flexGrow here; the slack that used
                  to live in this paragraph (and read as dead space on
                  shorter cards) now collects in one dedicated spacer just
                  above the divider, so every card's footer lines up at the
                  same position without an awkward gap mid-content. */}
              {scenario.facts.insight && (
                <p style={{
                  fontFamily: 'Inter, sans-serif',
                  fontSize:   14,
                  color:      '#3f484a',
                  lineHeight: 1.5,
                  margin:     0,
                }}>
                  {scenario.facts.insight as string}
                </p>
              )}

              {/* Cost delta — explicit +/− sign on the figure itself, plus
                  a genuine colour split (green = cheaper, grey = costs
                  more; amber dropped, reserved for CTAs) so "Save £118"
                  and "£118 more" can't be misread for each other even at a
                  glance, in case the two figures ever coincide. */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                {scenario.saving > 0 ? (
                  <>
                    <span style={{
                      fontFamily:    'Inter, sans-serif',
                      fontSize:      13,
                      fontWeight:    700,
                      color:         '#2e7d32',
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    }}>
                      −£{scenario.saving} saving
                    </span>
                    <span style={{
                      fontFamily: 'Inter, sans-serif',
                      fontSize:   12,
                      color:      '#6f797a',
                    }}>
                      total: £{scenario.scenario_total}
                    </span>
                  </>
                ) : scenario.saving === 0 ? (
                  <span style={{
                    fontFamily:    'Inter, sans-serif',
                    fontSize:      13,
                    fontWeight:    600,
                    color:         '#6f797a',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}>
                    £0 difference
                  </span>
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
                      +£{Math.abs(scenario.saving)} more
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

              {/* Spacer — absorbs the leftover height from the grid row's
                  tallest card, so the divider/link footer stays pinned to
                  the bottom of every card instead of that space appearing
                  as a random gap higher up. */}
              <div style={{ flexGrow: 1 }} />

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
