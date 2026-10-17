// Shared copy constants referenced verbatim from multiple cards/components,
// so a future wording change only has to happen in one place. See CLAUDE.md
// → "AI Recommendation Card System" for the redundancy these replaced.

// (BASELINE_NAME / BASELINE_NAME_LABEL — "the typical Saturday booking" — were removed with
// the baseline: the page no longer compares against it anywhere.)

// The one place "all-in" is defined for the reader. Rendered once, directly
// under the subheadline — every other mention of cost inclusions elsewhere
// on the page should say the bare word "all-in" and rely on this, not
// restate what it includes. Second sentence closes a gap the headline fix
// didn't cover: "all-in" on its own could be misread as including the
// holiday itself, not just getting there.
export const ALL_IN_DEFINITION = 'All-in = fare + bags + seats + transport to and from both airports. Flights and getting there. Accommodation isn\'t included.';

// Shown directly under ALL_IN_DEFINITION, and only when the destination airport has no stored
// transfer price (destination_airports transit/taxi columns empty, so the RPC returns
// destination_transfer_known = false and a £0 transfer — Malta's MLA today). Without it the
// definition above would claim a transfer the figures don't contain.
export function londonTransitUnpricedNote(postcodeDistrict: string): string {
  return `We don't have travel costs from ${postcodeDistrict} to London's airports yet, so getting to and from the airport isn't in the all-in figures.`;
}

// Shown under ALL_IN_DEFINITION when the destination airport has no stored transfer price (see
// below). londonTransitUnpricedNote above is the London-side equivalent: shown only when the
// school's postcode district has no row in district_airport_transit (275 schools as of this
// writing), where every total leaves the airport journey out rather than counting it as £0.
export function destinationTransferUnpricedNote(destinationName: string): string {
  return `We don't have a price yet for getting from the airport to where you're staying in ${destinationName}, so that part isn't in the all-in figures.`;
}
