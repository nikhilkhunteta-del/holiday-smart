'use client';

import { useState } from 'react';

interface Props {
  defaultAdults: number;
  defaultChildren: number;
  defaultChildAges: number[];
  onSubmit: (adults: number, children: number, childAges: number[]) => void;
}

interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}

function Stepper({ label, value, min, max, onChange }: StepperProps) {
  return (
    <div className="flex items-center gap-sm">
      <span className="font-inter text-label-sm text-on-surface-variant whitespace-nowrap hidden sm:block">
        {label}
      </span>
      <span className="font-inter text-label-sm text-on-surface-variant whitespace-nowrap sm:hidden">
        {label.split(' ')[0]}
      </span>
      <div className="flex items-center gap-xs">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={`Decrease ${label}`}
          className="w-7 h-7 flex items-center justify-center rounded border border-outline-variant text-on-surface-variant font-inter text-body-md leading-none hover:border-primary hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed select-none"
        >
          −
        </button>
        <span className="w-7 text-center font-inter text-body-md font-semibold text-on-surface select-none">
          {value}
        </span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={`Increase ${label}`}
          className="w-7 h-7 flex items-center justify-center rounded border border-outline-variant text-on-surface-variant font-inter text-body-md leading-none hover:border-primary hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed select-none"
        >
          +
        </button>
      </div>
    </div>
  );
}

const AGE_LABEL = (age: number) =>
  age === 0 ? 'Under 1' : age === 1 ? '1 year' : `${age} yrs`;

export function TravellerBanner({ defaultAdults, defaultChildren, defaultChildAges, onSubmit }: Props) {
  const [adults, setAdults]     = useState(defaultAdults);
  const [children, setChildren] = useState(defaultChildren);
  const [childAges, setChildAges] = useState<number[]>(defaultChildAges);

  function handleChildrenChange(newCount: number) {
    setChildren(newCount);
    if (newCount > childAges.length) {
      setChildAges([...childAges, ...Array<number>(newCount - childAges.length).fill(5)]);
    } else {
      setChildAges(childAges.slice(0, newCount));
    }
  }

  function handleAgeChange(idx: number, age: number) {
    const next = [...childAges];
    next[idx] = age;
    setChildAges(next);
  }

  return (
    <div className="bg-surface-container-lowest border-b border-outline-variant shadow-sm">
      <div className="max-w-content mx-auto px-margin-desktop py-md flex flex-wrap items-center gap-lg">

        {/* Label */}
        <span className="font-inter text-label-md uppercase tracking-wider text-on-surface-variant whitespace-nowrap">
          Who&apos;s travelling?
        </span>

        {/* Divider */}
        <div className="hidden md:block w-px h-5 bg-outline-variant flex-shrink-0" />

        {/* Adults stepper */}
        <Stepper label="Adults" value={adults} min={1} max={6} onChange={setAdults} />

        {/* Children stepper */}
        <Stepper label="Children" value={children} min={0} max={6} onChange={handleChildrenChange} />

        {/* Child age dropdowns */}
        {children > 0 && (
          <>
            <div className="hidden md:block w-px h-5 bg-outline-variant flex-shrink-0" />
            <div className="flex flex-wrap items-center gap-sm">
              {Array.from({ length: children }, (_, i) => (
                <div key={i} className="flex flex-col gap-xs">
                  <label
                    htmlFor={`child-age-${i}`}
                    className="font-inter text-label-sm text-outline leading-none"
                  >
                    Child {i + 1}
                  </label>
                  <select
                    id={`child-age-${i}`}
                    value={childAges[i] ?? 5}
                    onChange={(e) => handleAgeChange(i, parseInt(e.target.value))}
                    className="border border-outline-variant rounded-md px-sm font-inter text-label-md text-on-surface bg-surface-container-lowest focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-colors cursor-pointer"
                    style={{ paddingTop: '6px', paddingBottom: '6px' }}
                  >
                    {Array.from({ length: 18 }, (_, age) => (
                      <option key={age} value={age}>{AGE_LABEL(age)}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Submit */}
        <button
          type="button"
          onClick={() => onSubmit(adults, children, childAges)}
          className="font-inter text-label-md font-semibold text-white rounded-md px-lg py-sm whitespace-nowrap transition-opacity hover:opacity-90 active:opacity-80"
          style={{ background: '#d9622b' }}
        >
          Calculate my costs →
        </button>

      </div>
    </div>
  );
}
