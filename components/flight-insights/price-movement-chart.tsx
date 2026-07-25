'use client';

// Small bar chart for the "How this price has moved" card — one bar per
// usable price-history point, each labelled with its price directly (not
// hidden behind hover/expand). Bars are neutral (all teal primary): the copy
// in the card above carries the direction, not the chart colour. Values are
// airfare only (summed party_total_gbp per leg) — the "airfare only"
// subtitle rendered above this chart, in ai-recommendation-client.tsx, is
// what clarifies that against the page's other all-in totals.

interface PricePoint {
  checked_on: string;
  total_gbp: number;
}

const WIDTH = 480;
const PAD_LEFT = 8;
const PAD_RIGHT = 8;
const PAD_TOP = 12;
const BAR_RADIUS = 4;
// Headroom above the tallest bar — large enough to fit its price label
// without clipping against the top of the viewBox.
const HEADROOM_MULTIPLIER = 1.35;

function formatCheckDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Rounded top corners only, square bottom anchored to the baseline —
// rx/ry on <rect> would round all four corners.
function roundedTopBarPath(x: number, y: number, width: number, height: number, r: number): string {
  const radius = Math.min(r, height, width / 2);
  return [
    `M ${x} ${y + radius}`,
    `Q ${x} ${y} ${x + radius} ${y}`,
    `L ${x + width - radius} ${y}`,
    `Q ${x + width} ${y} ${x + width} ${y + radius}`,
    `L ${x + width} ${y + height}`,
    `L ${x} ${y + height}`,
    'Z',
  ].join(' ');
}

export function PriceMovementChart({
  points, fullWidth = false, compact = false,
}: {
  points: PricePoint[];
  // The top-section card lives in a narrower ~7-column area, where a
  // 480px cap looks intentional. The below-matrix section is genuinely
  // full-width with no adjacent booking box — capping it the same way
  // just leaves empty space. fullWidth drops the cap so the SVG (bars,
  // gaps, labels) scales up with its real container width instead of
  // stopping at 480px.
  fullWidth?: boolean;
  // Shrinks the viewBox height/padding for the compact below-matrix card,
  // which shows this chart at a much smaller visual weight than the
  // top-section card. Does not change the top-section card, which never
  // passes this prop.
  compact?: boolean;
}) {
  if (points.length < 2) return null;

  const HEIGHT = compact ? 124 : 160;
  const PAD_BOTTOM = compact ? 22 : 28;

  // Defensive sort — the x-axis math below depends on ascending order.
  const sorted = [...points].sort((a, b) => a.checked_on.localeCompare(b.checked_on));

  const chartWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const chartHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const baselineY = HEIGHT - PAD_BOTTOM;

  const maxVal = Math.max(...sorted.map(p => p.total_gbp));
  const scaleMax = maxVal * HEADROOM_MULTIPLIER;

  // x-position is proportional to elapsed time between checks, not index —
  // equal-index spacing was misrepresenting genuinely uneven check
  // intervals (e.g. a 48-day gap rendered the same width as a 9-day gap).
  const t0 = new Date(sorted[0].checked_on + 'T00:00:00').getTime();
  const tLast = new Date(sorted[sorted.length - 1].checked_on + 'T00:00:00').getTime();
  const span = tLast - t0;

  const avgSlot = chartWidth / sorted.length;
  const barWidth = Math.max(10, Math.min(compact ? 22 : 28, avgSlot * 0.6));
  const trackWidth = chartWidth - barWidth;

  function centerX(iso: string): number {
    if (span <= 0) return PAD_LEFT + barWidth / 2 + trackWidth / 2;
    const t = new Date(iso + 'T00:00:00').getTime();
    return PAD_LEFT + barWidth / 2 + ((t - t0) / span) * trackWidth;
  }

  return (
    <div style={{ marginTop: compact ? 8 : 12, marginBottom: 4 }}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{ width: '100%', maxWidth: fullWidth ? 'none' : WIDTH, height: 'auto', display: 'block' }}
        role="img"
        aria-label="Bar chart of this flight's airfare across past checks, spaced by actual date (excludes bags, transit and transfers)"
      >
        <line
          x1={PAD_LEFT} y1={baselineY}
          x2={WIDTH - PAD_RIGHT} y2={baselineY}
          stroke="#e2e8e8" strokeWidth={1}
        />
        {sorted.map((p, i) => {
          const barHeight = scaleMax > 0 ? Math.max((p.total_gbp / scaleMax) * chartHeight, 2) : 2;
          const cx = centerX(p.checked_on);
          const x = cx - barWidth / 2;
          const y = baselineY - barHeight;
          return (
            <g key={`${p.checked_on}-${i}`}>
              <title>{`${formatCheckDate(p.checked_on)}: £${Math.round(p.total_gbp).toLocaleString('en-GB')} airfare`}</title>
              <path d={roundedTopBarPath(x, y, barWidth, barHeight, BAR_RADIUS)} fill="#004349" />
              {/* Price label — visible at a glance, not hidden behind hover/click */}
              <text
                x={cx}
                y={y - 6}
                textAnchor="middle"
                style={{ fontFamily: 'Inter, sans-serif', fontSize: compact ? 11 : 12, fontWeight: 600, fill: '#004349' }}
              >
                £{Math.round(p.total_gbp).toLocaleString('en-GB')}
              </text>
              <text
                x={cx}
                y={baselineY + 16}
                textAnchor="middle"
                style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fill: '#6f797a' }}
              >
                {formatCheckDate(p.checked_on)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
