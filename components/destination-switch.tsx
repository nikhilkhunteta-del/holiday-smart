'use client';

/**
 * "Barcelona | Malta" switch at the top of the results page: plain links that change only
 * ?destination= and keep every other parameter (school, dates, family, preferences, tab). The
 * links are built from the live URL (useSearchParams), so a tab chosen after the page loaded —
 * which only pushState-s ?tab= — is kept too. The current destination is marked with
 * aria-current and a raised pill.
 *
 * Only destinations with flight data for the family's dates are offered
 * (lib/flights/destinationsWithFlights.ts); with fewer than two there is nothing to switch
 * between and nothing renders.
 */
import { useSearchParams } from 'next/navigation';
import type { DestinationOption } from '@/lib/flights/destinationsWithFlights';

interface Props {
  options: DestinationOption[];
  current: string;
}

export function DestinationSwitch({ options, current }: Props) {
  const searchParams = useSearchParams();
  if (options.length < 2) return null;
  const hrefFor = (slug: string) => {
    const p = new URLSearchParams(searchParams?.toString() ?? '');
    p.set('destination', slug);
    return `?${p.toString()}`;
  };
  return (
    <div className="flex items-center gap-3">
      <span className="font-inter text-[12px] leading-4 font-bold uppercase tracking-[0.06em] text-on-surface-variant">
        Destination
      </span>
      <div className="inline-flex rounded-md bg-surface-container-low border border-primary/10 p-[3px]" role="group" aria-label="Destination">
        {options.map(o => {
          const active = o.slug === current;
          return (
            <a
              key={o.slug}
              href={hrefFor(o.slug)}
              aria-current={active ? 'page' : undefined}
              className={`px-4 py-1.5 rounded-[9px] font-inter text-[14px] leading-5 transition-colors ${
                active
                  ? 'bg-surface-container-lowest text-primary font-semibold shadow-sm'
                  : 'text-on-surface-variant hover:text-primary'
              }`}
            >
              {o.name}
            </a>
          );
        })}
      </div>
    </div>
  );
}
