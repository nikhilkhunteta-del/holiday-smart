'use client';

// Slim persistent bar shown once the main booking box has scrolled out of
// view — independent of that box's own lg:-only CSS `sticky` (which only
// holds it in place while its containing grid row is still on screen).
// Fixed to the viewport bottom so it works the same on mobile (no lg:
// sticky today) and desktop (once the sticky box's containing block has
// scrolled past). z-index 40, deliberately below the leg-options modal's
// Dialog (components/ui/dialog.tsx uses z-50) so the bar never visually
// competes with it.

interface StickyBookingBarProps {
  visible: boolean;
  destinationName: string;
  nights: number | null;
  totalCostGbp: number | null;
  bookUrl: string;
}

export function StickyBookingBar({
  visible, destinationName, nights, totalCostGbp, bookUrl,
}: StickyBookingBarProps) {
  if (!visible || totalCostGbp == null) return null;

  return (
    <div
      role="region"
      aria-label="Booking summary"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 40,
        background: '#ffffff',
        borderTop: '1px solid #e1e3e3',
        boxShadow: '0 -4px 16px -4px rgba(13,92,99,0.16)',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <div style={{ minWidth: 0, overflow: 'hidden' }}>
        <div style={{
          fontFamily: 'Inter, sans-serif',
          fontSize: 11,
          color: '#6f797a',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {nights != null ? `${nights} nights in ${destinationName}` : destinationName}
        </div>
        <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 20, fontWeight: 600, color: '#004349' }}>
          £{Math.round(totalCostGbp)}
        </div>
      </div>
      <a
        href={bookUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          flexShrink: 0,
          background: '#004349',
          color: '#ffffff',
          fontFamily: 'Inter, sans-serif',
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          textDecoration: 'none',
          padding: '10px 20px',
          borderRadius: 10,
        }}
      >
        Book
      </a>
    </div>
  );
}
