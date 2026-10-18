/**
 * The Weather tab on the results page. Server component: renders only what it is given —
 * the stored weather_window_stats row, the stored strip cells, and computeWeatherVerdict()'s
 * output. No fetching, no AI, nothing computed beyond formatting. Any card whose inputs are
 * missing is hidden rather than shown with a placeholder.
 *
 * Layout follows the Stitch design (docs/design/weather-tab-stitch.html) on desktop. On a
 * phone the strip fits a 9-day window without scrolling; a longer window scrolls sideways
 * inside the strip only, with the year column pinned.
 */
import { SOME_RAIN_DEFINITION, type WeatherCard, type WeatherVerdict } from '@/lib/weather/computeWeatherVerdict';
import type { StripCellState, WeatherTabData } from '@/lib/weather/loadWeatherTab';
import { windowLengthDays } from '@/lib/weather/loadWeatherTab';

// Three steps of one blue, light -> dark as the day gets worse. Steps differ mainly in
// lightness, so they stay apart under every common colour-vision deficiency; deliberately not
// the brand's Deep Teal or the error red.
const CELL_COLOURS: Record<StripCellState, string> = {
  dry: '#dbe8f4',
  some_rain: '#7aa9d4',
  washout: '#1f4f7f',
};
const CELL_LABELS: Record<StripCellState, string> = {
  dry: 'Dry',
  some_rain: 'Some rain',
  washout: 'Washout',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function utcDate(iso: string, addDays = 0): Date {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + addDays);
  return d;
}

/** "Mon 19 – Fri 30 Oct 2026" (month repeated only when the window crosses one). */
export function formatWindow(start: string, end: string): string {
  const s = utcDate(start);
  const e = utcDate(end);
  const sPart = `${WEEKDAYS[s.getUTCDay()]} ${s.getUTCDate()}${s.getUTCMonth() !== e.getUTCMonth() ? ` ${MONTHS[s.getUTCMonth()]}` : ''}`;
  return `${sPart} – ${WEEKDAYS[e.getUTCDay()]} ${e.getUTCDate()} ${MONTHS[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
}

const cardClass = 'bg-surface-container-lowest rounded-lg shadow-md border border-primary/10';
const labelClass = 'font-inter text-[12px] leading-4 font-bold uppercase tracking-[0.06em] text-on-surface-variant';
const dataClass = 'font-inter text-[28px] md:text-[32px] leading-none font-semibold tracking-[-0.03em] text-primary';
// The pinned year column, with a white edge covering the gap so scrolled cells never show through.
const pinnedClass = 'sticky left-0 z-10 bg-surface-container-lowest shadow-[4px_0_0_0_#ffffff]';

// ── Strip ────────────────────────────────────────────────────────────────────

function Strip({ data, verdict }: { data: WeatherTabData; verdict: WeatherVerdict }) {
  const { row, strip } = data;
  const days = windowLengthDays(row.window_start, row.window_end);
  const columns = Array.from({ length: days }, (_, i) => utcDate(row.window_start, i));
  // 1.5rem minimum cells: 9 days fit a 390px phone; anything longer scrolls inside the card.
  const gridStyle = { gridTemplateColumns: `2.25rem repeat(${days}, minmax(1.5rem, 1fr))` };
  const headlineN = num(row.headline_years_used) ?? num(row.headline_total_years);

  return (
    <div className={`${cardClass} p-3 sm:p-6`}>
      <div className="overflow-x-auto">
        <div className="min-w-fit">
          <div className="grid gap-[3px] sm:gap-1.5 mb-1" style={gridStyle} aria-hidden="true">
            <div className={`${labelClass} ${pinnedClass} text-[10px] text-right pr-1 self-end`}>{MONTHS[columns[0].getUTCMonth()]}</div>
            {columns.map(d => (
              <div key={d.toISOString()} className="text-center font-inter text-[11px] leading-tight text-on-surface-variant">
                <span className="block sm:hidden font-semibold">{WEEKDAYS[d.getUTCDay()][0]}</span>
                <span className="hidden sm:block font-semibold uppercase tracking-[0.04em]">{WEEKDAYS[d.getUTCDay()]}</span>
                <span className="block">{d.getUTCDate()}</span>
              </div>
            ))}
          </div>
          <p className="sticky left-0 w-fit mb-2 font-inter text-[11px] leading-4 text-on-surface-variant">
            Days of the week are for {columns[0].getUTCFullYear()}.
          </p>

          <div className="flex flex-col gap-[3px] sm:gap-1" role="list" aria-label="Rain on these dates, year by year">
            {strip.map(({ year, days: cells }, index) => {
              const washouts = cells.filter(c => c === 'washout').length;
              const someRain = cells.filter(c => c === 'some_rain').length;
              const yearRow = (
                <div
                  key={year}
                  role="listitem"
                  aria-label={`${year}: ${washouts} washout ${washouts === 1 ? 'day' : 'days'}, ${someRain} ${someRain === 1 ? 'day' : 'days'} with some rain`}
                  className="grid gap-[3px] sm:gap-1.5 items-center"
                  style={gridStyle}
                >
                  <div className={`${pinnedClass} font-inter text-[11px] font-semibold text-on-surface-variant text-right pr-1 tabular-nums`} aria-hidden="true">
                    {year}
                  </div>
                  {cells.map((state, i) => {
                    const date = utcDate(row.window_start, i);
                    const title = `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${year}: ${state ? CELL_LABELS[state] : 'No data'}`;
                    return (
                      <div
                        key={i}
                        title={title}
                        aria-hidden="true"
                        className="h-4 sm:h-5 rounded-[3px] sm:rounded-md"
                        style={state ? { background: CELL_COLOURS[state] } : { background: 'transparent', border: '1px dashed #bfc8c9' }}
                      />
                    );
                  })}
                </div>
              );
              // Thin rule under the headline years (the most recent headlineN rows).
              if (headlineN === null || index !== headlineN - 1 || index === strip.length - 1) return yearRow;
              return [
                yearRow,
                <div key={`${year}-divider`} className="flex items-center gap-2 my-1" aria-hidden="true">
                  <div className="flex-1 border-t border-primary/40" />
                  <span className="sticky right-0 bg-surface-container-lowest pl-1 font-inter text-[11px] leading-4 text-on-surface-variant whitespace-nowrap">
                    Headline years above
                  </span>
                </div>,
              ];
            })}
          </div>
        </div>
      </div>

      <div className="mt-5 pt-4 border-t border-primary/10">
        <div className={`flex flex-wrap gap-x-6 gap-y-2 ${labelClass}`}>
          {(Object.keys(CELL_COLOURS) as StripCellState[]).map(s => (
            <div key={s} className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm inline-block" style={{ background: CELL_COLOURS[s] }} />
              {CELL_LABELS[s]}
            </div>
          ))}
        </div>
        {verdict.rainTiming && (
          <p className="mt-3 font-inter text-[14px] leading-5 text-on-surface-variant">{verdict.rainTiming.text}</p>
        )}
      </div>
    </div>
  );
}

// ── Stat tiles beside the strip ───────────────────────────────────────────────

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className={`${cardClass} p-4 sm:p-6`}>
      <div className={`${dataClass} mb-2`}>{value}</div>
      <div className={labelClass}>{label}</div>
    </div>
  );
}

function StripStats({ data }: { data: WeatherTabData }) {
  const { row } = data;
  const stripYears = num(row.strip_years_used);
  const noWashout = data.stripNoWashoutYears;
  const min = num(row.washout_days_min);
  const max = num(row.washout_days_max);
  const consecutive = num(row.consecutive_washout_years);

  const tiles: { value: string; label: string }[] = [];
  if (noWashout !== null && stripYears !== null) {
    tiles.push({ value: `${noWashout} in ${stripYears}`, label: 'Years with no washout day' });
  }
  if (min !== null && max !== null && stripYears !== null) {
    tiles.push({ value: `${min}–${max}`, label: `Washout days, fewest to most, across ${stripYears} years` });
  }
  if (consecutive !== null && stripYears !== null) {
    tiles.push({ value: `${consecutive} in ${stripYears}`, label: 'Years with two washouts in a row' });
  }
  if (tiles.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-1 gap-3 sm:gap-6">
      {tiles.map(t => <StatTile key={t.label} {...t} />)}
    </div>
  );
}

// ── Temperature, sea and daylight cards ──────────────────────────────────────

function ConditionCard({ value, label, detail }: WeatherCard) {
  return (
    <div className={`${cardClass} p-6 flex flex-col justify-between h-full`}>
      <div>
        <div className={`${dataClass} mb-2`}>{value}</div>
        <div className={`${labelClass} mb-4`}>{label}</div>
      </div>
      {detail && (
        <div className="font-inter text-[14px] leading-5 text-on-surface-variant border-t border-primary/10 pt-4">{detail}</div>
      )}
    </div>
  );
}

function Conditions({ verdict }: { verdict: WeatherVerdict }) {
  const cards = [verdict.temperature, verdict.sea, verdict.daylight].filter((c): c is NonNullable<typeof c> => c !== null);
  if (cards.length === 0) return null;
  return (
    <section className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
      {cards.map(c => <ConditionCard key={c.label} value={c.value} label={c.label} detail={c.detail} />)}
    </section>
  );
}

// ── Notes ─────────────────────────────────────────────────────────────────────

function Method({ data, verdict }: { data: WeatherTabData; verdict: WeatherVerdict }) {
  const years = data.strip.map(s => s.year);
  const headlineN = num(data.row.headline_years_used) ?? num(data.row.headline_total_years);
  let spans: string | null = null;
  if (years.length > 0 && headlineN !== null) {
    const latest = Math.max(...years);
    const earliest = Math.min(...years);
    spans =
      `The headline and temperature figures use the most recent ${headlineN} years (${latest - headlineN + 1}–${latest}); ` +
      `the strip, the figures beside it, rain timing and very heavy rain use all ${years.length} (${earliest}–${latest}).`;
  }
  return (
    <section className="border-t border-primary/10 pt-8">
      <div className="font-inter text-[13px] leading-5 text-on-surface-variant max-w-3xl space-y-2">
        <p>{verdict.definition} {SOME_RAIN_DEFINITION}</p>
        {verdict.severeRain && <p>{verdict.severeRain}</p>}
        {spans && <p>{spans}</p>}
        <p>
          Weather history from{' '}
          <a href="https://open-meteo.com/" className="underline underline-offset-2 hover:text-primary" target="_blank" rel="noreferrer">
            Open-Meteo
          </a>{' '}
          (historical weather and marine data), licensed under CC BY 4.0.
        </p>
      </div>
    </section>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────

export function WeatherTab({ data, verdict }: { data: WeatherTabData; verdict: WeatherVerdict }) {
  const { row } = data;
  const days = windowLengthDays(row.window_start, row.window_end);

  return (
    <div className="flex flex-col gap-10 md:gap-xl">
      <div className="flex flex-col gap-4">
        <div className="font-inter text-[15px] text-on-surface-variant">
          {data.destinationName} · {formatWindow(row.window_start, row.window_end)} · {days} days
          {data.extended && ' · your half-term plus the weekends either side'}
        </div>
        {verdict.tierPhrase && (
          <h1 className="font-newsreader text-[36px] leading-[1.1] sm:text-display-md md:text-display-lg font-semibold text-primary">
            {verdict.tierPhrase}
          </h1>
        )}
        {verdict.headline && (
          <p className="font-inter text-[17px] leading-7 sm:text-body-lg text-on-surface max-w-3xl">{verdict.headline}</p>
        )}
        {verdict.basis && <p className="font-inter text-[14px] leading-5 text-on-surface-variant">{verdict.basis}</p>}
      </div>

      {data.strip.length > 0 && (
        <section className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-8 items-start">
          <div className="md:col-span-8 lg:col-span-9 min-w-0">
            <Strip data={data} verdict={verdict} />
          </div>
          <div className="md:col-span-4 lg:col-span-3">
            <StripStats data={data} />
          </div>
        </section>
      )}

      <Conditions verdict={verdict} />
      <Method data={data} verdict={verdict} />
    </div>
  );
}
