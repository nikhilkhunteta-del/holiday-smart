/**
 * The Weather tab on the results page. Server component: renders only what it is given —
 * the stored weather_window_stats row, the stored strip cells, and computeWeatherVerdict()'s
 * output. No fetching, no AI, nothing computed beyond formatting. Any card whose inputs are
 * missing is hidden rather than shown with a placeholder.
 *
 * Layout follows the Stitch design (docs/design/weather-tab-stitch.html) on desktop; the
 * phone layout keeps the 20 x N strip as a grid with narrower cells and one-letter weekday
 * headers so it stays readable at 380px.
 */
import { SOME_RAIN_DEFINITION, type WeatherVerdict } from '@/lib/weather/computeWeatherVerdict';
import type { StripCellState, WeatherTabData } from '@/lib/weather/loadWeatherTab';
import { windowLengthDays } from '@/lib/weather/loadWeatherTab';

// Ordinal scale, pale -> dark as the day gets worse. Kept from the design.
const CELL_COLOURS: Record<StripCellState, string> = {
  dry: '#d1e0d7',
  some_rain: '#fdba49',
  washout: '#ba1a1a',
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

/** 1 -> "1", 1.5 -> "1.5". */
function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

const cardClass = 'bg-surface-container-lowest rounded-lg shadow-md border border-primary/10';
const labelClass = 'font-inter text-[12px] leading-4 font-bold uppercase tracking-[0.06em] text-on-surface-variant';
const dataClass = 'font-inter text-[28px] md:text-[32px] leading-none font-semibold tracking-[-0.03em] text-primary';

// ── Strip ────────────────────────────────────────────────────────────────────

function Strip({ data }: { data: WeatherTabData }) {
  const { row, strip } = data;
  const days = windowLengthDays(row.window_start, row.window_end);
  const columns = Array.from({ length: days }, (_, i) => utcDate(row.window_start, i));
  const gridStyle = { gridTemplateColumns: `2.25rem repeat(${days}, minmax(0, 1fr))` };

  return (
    <div className={`${cardClass} p-3 sm:p-6`}>
      <div className="grid gap-[3px] sm:gap-1.5 mb-1.5" style={gridStyle} aria-hidden="true">
        <div className={`${labelClass} text-[10px] text-right pr-1 self-end`}>{MONTHS[columns[0].getUTCMonth()]}</div>
        {columns.map(d => (
          <div key={d.toISOString()} className="text-center font-inter text-[10px] sm:text-[11px] leading-tight text-on-surface-variant">
            <span className="block sm:hidden font-semibold">{WEEKDAYS[d.getUTCDay()][0]}</span>
            <span className="hidden sm:block font-semibold uppercase tracking-[0.04em]">{WEEKDAYS[d.getUTCDay()]}</span>
            <span className="block">{d.getUTCDate()}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-[3px] sm:gap-1" role="list" aria-label="Rain on these dates, year by year">
        {strip.map(({ year, days: cells }) => {
          const washouts = cells.filter(c => c === 'washout').length;
          const someRain = cells.filter(c => c === 'some_rain').length;
          return (
            <div
              key={year}
              role="listitem"
              aria-label={`${year}: ${washouts} washout ${washouts === 1 ? 'day' : 'days'}, ${someRain} ${someRain === 1 ? 'day' : 'days'} with some rain`}
              className="grid gap-[3px] sm:gap-1.5 items-center"
              style={gridStyle}
            >
              <div className="font-inter text-[10px] sm:text-[11px] font-semibold text-on-surface-variant text-right pr-1 tabular-nums" aria-hidden="true">
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
                    className="h-3.5 sm:h-5 rounded-[3px] sm:rounded-md"
                    style={state ? { background: CELL_COLOURS[state] } : { background: 'transparent', border: '1px dashed #bfc8c9' }}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      <div className={`flex flex-wrap gap-x-6 gap-y-2 mt-5 pt-4 border-t border-primary/10 ${labelClass}`}>
        {(Object.keys(CELL_COLOURS) as StripCellState[]).map(s => (
          <div key={s} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ background: CELL_COLOURS[s] }} />
            {CELL_LABELS[s]}
          </div>
        ))}
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
  const typical = num(row.typical_washout_days);
  const min = num(row.washout_days_min);
  const max = num(row.washout_days_max);
  const consecutive = num(row.consecutive_washout_years);

  const tiles: { value: string; label: string }[] = [];
  if (typical !== null && stripYears !== null) {
    tiles.push({ value: `${fmtNum(typical)} ${typical === 1 ? 'day' : 'days'}`, label: `Typical washout days (median of ${stripYears} years)` });
  }
  if (min !== null && max !== null && stripYears !== null) {
    tiles.push({ value: `${min}–${max}`, label: `Washout days, fewest to most, across ${stripYears} years` });
  }
  if (consecutive !== null && stripYears !== null) {
    tiles.push({ value: `${consecutive} in ${stripYears}`, label: 'Years with two washouts in a row' });
  }
  if (tiles.length === 0) return null;

  return (
    <div className="grid grid-cols-1 min-[420px]:grid-cols-3 md:grid-cols-1 gap-3 sm:gap-6">
      {tiles.map(t => <StatTile key={t.label} {...t} />)}
    </div>
  );
}

// ── Rain timing ───────────────────────────────────────────────────────────────

function RainTiming({ data, verdict }: { data: WeatherTabData; verdict: WeatherVerdict }) {
  const timing = verdict.rainTiming;
  if (!timing) return null;

  const bars = Object.entries(data.row.hourly_rain_share ?? {})
    .map(([h, v]) => ({ hour: Number(h), pct: (num(v) ?? 0) * 100 }))
    .filter(b => Number.isInteger(b.hour) && b.hour >= 0 && b.hour < 24)
    .sort((a, b) => a.hour - b.hour);
  const maxPct = Math.max(0, ...bars.map(b => b.pct));
  const hh = (h: number) => String(h).padStart(2, '0');
  const stripYears = num(data.row.strip_years_used);

  return (
    <section className={`${cardClass} p-5 sm:p-8 grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 items-center`}>
      <div className="md:col-span-1 border-b md:border-b-0 md:border-r border-primary/10 pb-6 md:pb-0 md:pr-6">
        <h2 className="font-newsreader text-[24px] leading-8 font-medium text-primary mb-4">{timing.heading}</h2>
        <div className={`${dataClass} mb-1`}>{Math.round(timing.pct_after_2pm)}%</div>
        <div className={labelClass}>{timing.stat_label}</div>
      </div>

      {bars.length > 0 && maxPct > 0 && (
        <figure className="md:col-span-2">
          <div className="relative h-40 sm:h-48 flex items-end gap-[2px] sm:gap-1" aria-hidden="true">
            {bars.map(b => (
              <div
                key={b.hour}
                className={`relative h-full flex-1 flex items-end justify-center ${b.hour === 14 ? 'border-l border-dashed border-primary/40' : ''}`}
                title={`${hh(b.hour)}:00–${hh(b.hour + 1)}:00 — ${b.pct.toFixed(1)}% of rainy daylight hours`}
              >
                <div
                  className="w-full max-w-[24px] rounded-t bg-secondary-container"
                  style={{ height: `${(b.pct / maxPct) * 100}%`, minHeight: b.pct > 0 ? 2 : 0 }}
                />
                {b.hour === 14 && (
                  <span className="absolute top-0 left-1 font-inter text-[10px] font-semibold uppercase tracking-[0.04em] text-on-surface-variant whitespace-nowrap">
                    2pm →
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-[2px] sm:gap-1 border-t border-primary/20 pt-1.5" aria-hidden="true">
            {bars.map((b, i) => (
              <div key={b.hour} className="flex-1 text-center font-inter text-[10px] text-on-surface-variant tabular-nums">
                <span className={i % 2 === 1 ? 'hidden sm:inline' : ''}>{hh(b.hour)}</span>
              </div>
            ))}
          </div>
          <figcaption className="mt-3 font-inter text-[13px] leading-5 text-on-surface-variant">
            When rain fell in daylight, by hour of day{stripYears !== null ? `, across ${stripYears} years` : ''}. Local time.
          </figcaption>
          <div className="sr-only">
          <table>
            <caption>Share of rainy daylight hours by hour of day</caption>
            <thead><tr><th>Hour</th><th>Share</th></tr></thead>
            <tbody>
              {bars.map(b => (
                <tr key={b.hour}><td>{hh(b.hour)}:00</td><td>{b.pct.toFixed(1)}%</td></tr>
              ))}
            </tbody>
          </table>
          </div>
        </figure>
      )}
    </section>
  );
}

// ── Conditions cards ──────────────────────────────────────────────────────────

function ConditionCard({ value, label, note }: { value: string; label: string; note: string | null }) {
  return (
    <div className={`${cardClass} p-6 flex flex-col justify-between h-full`}>
      <div>
        <div className={`${dataClass} mb-2`}>{value}</div>
        <div className={`${labelClass} mb-4`}>{label}</div>
      </div>
      {note && (
        <div className="font-inter text-[14px] leading-5 text-on-surface-variant border-t border-primary/10 pt-4">{note}</div>
      )}
    </div>
  );
}

function Conditions({ data, verdict }: { data: WeatherTabData; verdict: WeatherVerdict }) {
  const { row } = data;
  const caveat = (k: string) => verdict.caveats.find(c => c.kind === k)?.text ?? null;
  const seaText = caveat('sea_temperature');
  const sea = num(row.sea_temp_c);
  const daylight = row.daylight_hours_minutes?.trim() || null;

  const cards: { value: string; label: string; note: string | null }[] = [];
  if (verdict.warmth) {
    cards.push({
      value: `${Math.round(verdict.warmth.low_c)}–${Math.round(verdict.warmth.high_c)}°C`,
      label: 'Daytime feels-like',
      note: verdict.evenings?.text ?? null,
    });
  }
  if (sea !== null && seaText) {
    cards.push({ value: `${Math.round(sea)}°C`, label: 'Sea temperature', note: seaText });
  }
  if (daylight) {
    cards.push({ value: daylight, label: 'Daylight, mid-trip', note: caveat('clock_change') });
  }
  if (verdict.severeRain) {
    cards.push({
      value: `${verdict.severeRain.count} in ${verdict.severeRain.strip_years}`,
      label: 'Years with a very heavy rain day',
      note: verdict.severeRain.text,
    });
  }
  if (cards.length === 0) return null;

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
      {cards.map(c => <ConditionCard key={c.label} {...c} />)}
    </section>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────

function Method({ data, verdict }: { data: WeatherTabData; verdict: WeatherVerdict }) {
  const years = data.strip.map(s => s.year);
  const headlineN = num(data.row.headline_years_used) ?? num(data.row.headline_total_years);
  let spans: string | null = null;
  if (years.length > 0 && headlineN !== null) {
    const latest = Math.max(...years);
    const earliest = Math.min(...years);
    spans =
      `The headline and feels-like figures use the most recent ${headlineN} years (${latest - headlineN + 1}–${latest}); ` +
      `the strip, the figures beside it, rain timing and very heavy rain use all ${years.length} (${earliest}–${latest}).`;
  }
  return (
    <section className="border-t border-primary/10 pt-8">
      <div className="font-inter text-[13px] leading-5 text-on-surface-variant max-w-3xl space-y-2">
        <p>{verdict.definition} {SOME_RAIN_DEFINITION}</p>
        {spans && <p>{spans}</p>}
        <p>
          Weather history from{' '}
          <a href="https://open-meteo.com/" className="underline underline-offset-2 hover:text-primary" target="_blank" rel="noreferrer">
            Open-Meteo
          </a>
          : the Historical Weather API (its default best-match model selection) for rain, temperature and daylight, and the
          Marine API for sea temperature. Data licensed under CC BY 4.0.
        </p>
      </div>
    </section>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────

export function WeatherTab({ data, verdict }: { data: WeatherTabData; verdict: WeatherVerdict }) {
  const { row } = data;
  const days = windowLengthDays(row.window_start, row.window_end);
  const headline = [verdict.tierPhrase, verdict.headline].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-10 md:gap-xl">
      <div className="flex flex-col gap-4">
        <div className="font-inter text-[15px] text-on-surface-variant">
          {data.destinationName} · {formatWindow(row.window_start, row.window_end)} · {days} days
        </div>
        {headline && (
          <h1 className="font-newsreader text-[30px] leading-[1.15] sm:text-display-md md:text-display-lg font-semibold text-primary max-w-4xl">
            {headline}
          </h1>
        )}
        {verdict.basis && <p className="font-inter text-[14px] text-on-surface-variant">{verdict.basis}</p>}
      </div>

      {data.strip.length > 0 && (
        <section className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-8 items-start">
          <div className="md:col-span-8 lg:col-span-9">
            <Strip data={data} />
          </div>
          <div className="md:col-span-4 lg:col-span-3">
            <StripStats data={data} />
          </div>
        </section>
      )}

      <RainTiming data={data} verdict={verdict} />
      <Conditions data={data} verdict={verdict} />
      <Method data={data} verdict={verdict} />
    </div>
  );
}
