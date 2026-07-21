'use client';

// Small bar chart for the "How this price has moved" card — one bar per
// usable price-history point. Bars are neutral (all teal primary): the copy
// in the card above carries the direction, not the chart colour.

interface PricePoint {
  checked_on: string;
  total_gbp: number;
}

const WIDTH = 480;
const HEIGHT = 160;
const PAD_LEFT = 8;
const PAD_RIGHT = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;
const BAR_GAP = 12;
const BAR_RADIUS = 4;

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

export function PriceMovementChart({ points }: { points: PricePoint[] }) {
  if (points.length < 2) return null;

  const chartWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const chartHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const baselineY = HEIGHT - PAD_BOTTOM;

  const maxVal = Math.max(...points.map(p => p.total_gbp));
  const scaleMax = maxVal * 1.08; // headroom so the tallest bar isn't clipped

  const barWidth = (chartWidth - BAR_GAP * (points.length - 1)) / points.length;

  return (
    <div style={{ marginTop: 12, marginBottom: 4 }}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{ width: '100%', maxWidth: WIDTH, height: 'auto', display: 'block' }}
        role="img"
        aria-label="Bar chart of this flight's all-in price across past checks"
      >
        <line
          x1={PAD_LEFT} y1={baselineY}
          x2={WIDTH - PAD_RIGHT} y2={baselineY}
          stroke="#e2e8e8" strokeWidth={1}
        />
        {points.map((p, i) => {
          const barHeight = scaleMax > 0 ? Math.max((p.total_gbp / scaleMax) * chartHeight, 2) : 2;
          const x = PAD_LEFT + i * (barWidth + BAR_GAP);
          const y = baselineY - barHeight;
          return (
            <g key={`${p.checked_on}-${i}`}>
              <title>{`${formatCheckDate(p.checked_on)}: £${Math.round(p.total_gbp).toLocaleString('en-GB')}`}</title>
              <path d={roundedTopBarPath(x, y, barWidth, barHeight, BAR_RADIUS)} fill="#004349" />
              <text
                x={x + barWidth / 2}
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
