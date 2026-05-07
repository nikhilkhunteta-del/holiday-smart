interface Props {
  contentHeight: number;
  columns?: 1 | 2 | 3;
  rows?: number;
}

function Pulse({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`animate-pulse rounded bg-surface-container-high ${className ?? ''}`}
      style={style}
    />
  );
}

export function SkeletonSection({ contentHeight, columns = 1, rows = 1 }: Props) {
  const colClass = columns === 3 ? 'grid-cols-1 lg:grid-cols-3' : columns === 2 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1';
  const cellHeight = Math.round(contentHeight / rows);

  return (
    <section aria-hidden="true">
      {/* Heading skeleton */}
      <div className="mb-lg flex flex-col gap-sm">
        <Pulse className="h-3 w-20" />
        <Pulse className="h-7 w-56" />
      </div>

      {/* Content skeleton */}
      <div className={`grid ${colClass} gap-lg`}>
        {Array.from({ length: columns * rows }, (_, i) => (
          <Pulse key={i} style={{ height: cellHeight }} />
        ))}
      </div>
    </section>
  );
}

// Named presets matching each section's approximate rendered height
export const SKELETONS = {
  calendar:        { contentHeight: 360, columns: 3 as const },
  compliance:      { contentHeight: 300, columns: 1 as const },
  familyCost:      { contentHeight: 320, columns: 1 as const, rows: 3 },
  capacityWarning: { contentHeight: 220, columns: 1 as const },
  multiAirport:    { contentHeight: 320, columns: 1 as const, rows: 5 },
  openJaw:         { contentHeight: 300, columns: 3 as const },
  stopover:        { contentHeight: 280, columns: 1 as const, rows: 3 },
  nearbyAirports:  { contentHeight: 280, columns: 2 as const, rows: 3 },
  multiModal:      { contentHeight: 260, columns: 2 as const },
  railChild:       { contentHeight: 240, columns: 1 as const, rows: 3 },
  oneWayReturn:    { contentHeight: 300, columns: 3 as const },
} satisfies Record<string, Props>;
