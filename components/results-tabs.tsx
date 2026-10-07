'use client';

/**
 * Flights / Weather tabs on the results page.
 *
 * The active tab lives in the URL (?tab=weather; Flights is the default and drops the param),
 * so a link to the Weather tab can be shared. Switching uses history.pushState, which Next 14
 * syncs into useSearchParams without a server round trip — the page is force-dynamic, so a
 * router navigation would re-run every flight RPC just to flip a tab.
 *
 * Both panels stay mounted and the inactive one is hidden: unmounting the Flights panel would
 * make AIRecommendationClient re-fetch /api/recommend every time the user came back to it.
 *
 * With no weather available there is no tab bar at all, and the Flights panel renders exactly
 * as the page did before tabs existed.
 */
import { useSearchParams } from 'next/navigation';
import type { MouseEvent, ReactNode } from 'react';

export type ResultsTab = 'flights' | 'weather';

function hrefFor(search: string, tab: ResultsTab): string {
  const p = new URLSearchParams(search);
  if (tab === 'weather') p.set('tab', 'weather');
  else p.delete('tab');
  const qs = p.toString();
  return qs ? `?${qs}` : '?';
}

export function useResultsTab(weatherAvailable: boolean): [ResultsTab, (tab: ResultsTab) => void, (tab: ResultsTab) => string] {
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? '';
  const tab: ResultsTab = weatherAvailable && searchParams?.get('tab') === 'weather' ? 'weather' : 'flights';
  const select = (next: ResultsTab) => {
    if (next === tab) return;
    window.history.pushState(null, '', hrefFor(window.location.search, next));
    window.scrollTo({ top: 0 });
  };
  return [tab, select, (t: ResultsTab) => hrefFor(search, t)];
}

/** Plain-click handler for an <a href="?tab=..."> that switches tab in place; modified clicks
 *  (new tab, copy link) fall through to the real link. */
function onTabLinkClick(e: MouseEvent<HTMLAnchorElement>, select: () => void) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  select();
}

interface Props {
  weatherAvailable: boolean;
  /** Short weather headline for the quiet line on the Flights tab; omitted when null. */
  weatherTeaser: string | null;
  flights: ReactNode;
  weather: ReactNode;
}

export function ResultsTabs({ weatherAvailable, weatherTeaser, flights, weather }: Props) {
  const [tab, select, href] = useResultsTab(weatherAvailable);

  if (!weatherAvailable) {
    return <>{flights}</>;
  }

  const tabs: { id: ResultsTab; label: string }[] = [
    { id: 'flights', label: 'Flights' },
    { id: 'weather', label: 'Weather' },
  ];

  // A div, not <nav>: styles/globals.css styles every bare <nav> as the landing-page header.
  return (
    <div className="flex flex-col gap-lg">
      <div role="tablist" aria-label="Results" className="flex gap-8 border-b border-outline-variant">
        {tabs.map(t => {
          const active = t.id === tab;
          return (
            <a
              key={t.id}
              id={`results-tab-${t.id}`}
              role="tab"
              aria-selected={active}
              aria-controls={`results-panel-${t.id}`}
              href={href(t.id)}
              onClick={e => onTabLinkClick(e, () => select(t.id))}
              className={`-mb-px pb-3 font-inter text-[12px] leading-4 font-bold uppercase tracking-[0.06em] transition-colors border-b-2 ${
                active ? 'text-primary border-primary' : 'text-on-surface-variant border-transparent hover:text-primary'
              }`}
            >
              {t.label}
            </a>
          );
        })}
      </div>

      <div
        id="results-panel-flights"
        role="tabpanel"
        aria-labelledby="results-tab-flights"
        hidden={tab !== 'flights'}
        // Tailwind's .flex would override the [hidden] display:none, so swap the class too.
        className={`${tab === 'flights' ? 'flex' : 'hidden'} flex-col gap-xl`}
      >
        {weatherTeaser && (
          <p className="font-inter text-[14px] leading-5 text-on-surface-variant">
            <span className="font-semibold text-primary">Weather:</span> {weatherTeaser}{' '}
            <a
              href={href('weather')}
              onClick={e => onTabLinkClick(e, () => select('weather'))}
              className="text-primary underline underline-offset-2 whitespace-nowrap"
            >
              See the weather →
            </a>
          </p>
        )}
        {flights}
      </div>

      <div id="results-panel-weather" role="tabpanel" aria-labelledby="results-tab-weather" hidden={tab !== 'weather'}>
        {weather}
      </div>
    </div>
  );
}
