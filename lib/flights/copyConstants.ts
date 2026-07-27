// Shared copy constants referenced verbatim from multiple cards/components,
// so a future wording change only has to happen in one place. See CLAUDE.md
// → "AI Recommendation Card System" for the redundancy these replaced.

// The name for the comparison baseline (a direct BA flight on the first
// Saturday of half-term) — previously called four different things across
// the headline, booking box, penalty card, and comparison table
// ("the standard Saturday booking from Heathrow" / "the typical booking" /
// "the Saturday booking" / "Typical Saturday"). Use this constant verbatim
// wherever the baseline is named in prose.
export const BASELINE_NAME = 'the typical Saturday booking';

// Short label form for compact UI contexts (table column headers etc.),
// where "Recommended" / "Inset day" style Title Case labels are the
// convention — not a different name for the baseline, just a different
// register. Keep in sync with BASELINE_NAME if either changes.
export const BASELINE_NAME_LABEL = 'Typical Saturday Booking';

// The one place "all-in" is defined for the reader. Rendered once, directly
// under the subheadline — every other mention of cost inclusions elsewhere
// on the page should say the bare word "all-in" and rely on this, not
// restate what it includes. Second sentence closes a gap the headline fix
// didn't cover: "all-in" on its own could be misread as including the
// holiday itself, not just getting there.
export const ALL_IN_DEFINITION = 'All-in = fare + bags + seats + transport to and from both airports. Flights and getting there. Accommodation isn\'t included.';
