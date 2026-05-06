'use client';

import { useState } from 'react';
import type { AirportFare } from '@/types/flight';

interface Props {
  fares: AirportFare[];
  destination: string;
  travelDate: string;
}

type SortKey = 'allInFromHome' | 'price' | 'transferMinutes';

const sortLabels: Record<SortKey, string> = {
  allInFromHome:   'Total from home',
  price:           'Fare only',
  transferMinutes: 'Transfer time',
};

function gbp(n: number) { return `£${n.toLocaleString('en-GB')}`; }

export function MultiAirportSection({ fares, destination, travelDate }: Props) {
  const [sortBy, setSortBy] = useState<SortKey>('allInFromHome');
  const sorted = [...fares].sort((a, b) => a[sortBy] - b[sortBy]);
  const best = sorted[0];

  return (
    <section aria-labelledby="multi-airport-heading">
      <div className="flex items-start justify-between mb-lg flex-wrap gap-md">
        <div>
          <span className="block font-inter text-label-sm uppercase tracking-widest text-primary-container mb-xs">
            Multi-Airport Search
          </span>
          <h2 id="multi-airport-heading" className="font-newsreader text-headline-lg text-on-surface">
            All London airports — same dates
          </h2>
          <p className="font-inter text-body-md text-on-surface-variant mt-sm">
            {destination} · {travelDate} · Including transfer cost & time from Hackney
          </p>
        </div>

        {/* Sort controls */}
        <div className="flex items-center gap-sm flex-wrap">
          <span className="font-inter text-label-sm text-outline">Sort by:</span>
          {(Object.keys(sortLabels) as SortKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              className={[
                'font-inter text-label-md rounded-full px-md py-xs border transition-all',
                sortBy === key
                  ? 'bg-primary text-on-primary border-primary'
                  : 'bg-transparent text-on-surface-variant border-outline-variant hover:border-outline',
              ].join(' ')}
            >
              {sortLabels[key]}
            </button>
          ))}
        </div>
      </div>

      {/* Best option callout */}
      <div
        className="flex items-center gap-md rounded-lg p-md mb-lg font-inter text-body-md"
        style={{ background: 'rgba(253,186,73,0.12)', border: '1px solid rgba(253,186,73,0.4)' }}
      >
        <span aria-hidden="true">✈</span>
        <span>
          <strong className="text-on-surface">{best.airportName} ({best.airport})</strong> is the best value from Hackney — {gbp(best.allInFromHome)} all-in including {best.transferMode} ({best.transferMinutes} min, {gbp(best.transferCost)}).
        </span>
      </div>

      {/* Airport fare cards */}
      <div className="flex flex-col gap-sm">
        {sorted.map((fare, i) => {
          const isBest = i === 0;
          return (
            <div
              key={fare.airport}
              className={[
                'bg-surface-container-lowest rounded-lg p-lg shadow-sm transition-shadow hover:shadow-md',
                isBest
                  ? 'border-2 border-primary'
                  : 'border border-outline-variant',
              ].join(' ')}
            >
              <div className="flex items-center justify-between flex-wrap gap-md">
                {/* Airport + carrier */}
                <div className="flex items-center gap-md">
                  <div
                    className="w-12 h-12 rounded-md flex items-center justify-center font-newsreader text-label-md font-semibold flex-shrink-0"
                    style={{ background: isBest ? '#004349' : '#eceeee', color: isBest ? '#ffffff' : '#3f484a' }}
                  >
                    {fare.airport}
                  </div>
                  <div>
                    <div className="flex items-center gap-sm flex-wrap">
                      <p className="font-inter text-body-md font-semibold text-on-surface">{fare.airportName}</p>
                      {isBest && (
                        <span
                          className="font-inter text-label-sm rounded-full px-sm py-xs"
                          style={{ background: 'rgba(253,186,73,0.2)', color: '#704b00' }}
                        >
                          ★ Best value
                        </span>
                      )}
                    </div>
                    <p className="font-inter text-label-sm text-outline">{fare.carrier} · {fare.fareFamily}</p>
                  </div>
                </div>

                {/* Times */}
                <div className="text-center">
                  <p className="font-inter text-body-md font-semibold text-on-surface">{fare.departureTime}</p>
                  <p className="font-inter text-label-sm text-outline">→ {fare.arrivalTime}</p>
                </div>

                {/* Transfer */}
                <div className="text-center">
                  <p className="font-inter text-label-sm text-outline mb-xs">Transfer</p>
                  <p className="font-inter text-body-md font-medium text-on-surface">{fare.transferMinutes} min</p>
                  <p className="font-inter text-label-sm text-on-surface-variant">{fare.transferMode}</p>
                  <p className="font-inter text-label-sm text-on-surface-variant">{gbp(fare.transferCost)}</p>
                </div>

                {/* Prices */}
                <div className="text-right">
                  <p className="font-inter text-label-sm text-outline mb-xs">Fare (family)</p>
                  <p className="font-inter text-body-md font-medium text-on-surface">{gbp(fare.familyTotal)}</p>
                  <div className="h-px bg-outline-variant my-xs" />
                  <p className="font-inter text-label-sm text-outline mb-xs">All-in from home</p>
                  <p className="font-newsreader text-headline-md text-primary">{gbp(fare.allInFromHome)}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="font-inter text-label-sm text-outline mt-md">
        Transfer costs and times are estimates based on current TfL/National Rail pricing from Hackney Central.
      </p>
    </section>
  );
}
