// Google Flights URL builder (protobuf tfs encoding), shared by the
// top-section booking box (ai-recommendation-client.tsx) and the matrix
// modal's "Book these dates" button (leg-options-modal.tsx). Moved here
// unchanged from ai-recommendation-client.tsx so both can reuse it without
// duplicating the protobuf encoding.
//
// Schema reverse-engineered from live Google Flights URLs:
//   field 1 (varint 28), field 2 (varint 2) — constants
//   field 3 (msg): flight leg { field 13: origin airport, field 2: date, field 14: dest airport }
//   airport msg: { field 1: 1 (IATA type), field 2: IATA code }
//   field 14 (varint 1) = economy, field 8/9 = 1, field 19 = 1 (round-trip) / 2 (one-way)
//
// KNOWN LIMITATION (see CLAUDE.md "Known Issues"): this schema does not
// encode airline/carrier or party size — only origin, destination, date,
// and trip-type. A link built from a specific carrier's fare opens a
// generic search for that route/date, not a carrier-filtered one, and
// adults/children params below are accepted but unused for this reason.

function encodeTfs(legs: Array<{ origin: string; dest: string; date: string }>, oneWay: boolean): string {
  function varint(v: number): number[] {
    const bytes: number[] = []; v = v >>> 0;
    while (v > 0x7f) { bytes.push((v & 0x7f) | 0x80); v >>>= 7; }
    bytes.push(v & 0x7f); return bytes;
  }
  function tag(f: number, w: number) { return varint((f << 3) | w); }
  function str(f: number, s: string) {
    const b = Array.from(new TextEncoder().encode(s));
    return [...tag(f, 2), ...varint(b.length), ...b];
  }
  function vi(f: number, v: number) { return [...tag(f, 0), ...varint(v)]; }
  function msg(f: number, inner: number[]) { return [...tag(f, 2), ...varint(inner.length), ...inner]; }
  function airport(f: number, iata: string) { return msg(f, [...vi(1, 1), ...str(2, iata)]); }
  function leg(o: string, d: string, date: string) {
    return msg(3, [...airport(13, o), ...str(2, date), ...airport(14, d)]);
  }

  const bytes = [
    ...vi(1, 28), ...vi(2, 2),
    ...legs.flatMap(l => leg(l.origin, l.dest, l.date)),
    ...vi(14, 1), ...vi(8, 1), ...vi(9, 1),
    ...vi(19, oneWay ? 2 : 1),
  ];
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function buildGoogleFlightsUrl(params: {
  origin: string;
  destination: string;
  date: string;
  adults: number;
  children: number;
}): string {
  const tfs = encodeTfs([{ origin: params.origin, dest: params.destination, date: params.date }], true);
  return `https://www.google.com/travel/flights/search?tfs=${tfs}&curr=GBP&hl=en-GB`;
}

export function buildGoogleFlightsRoundTripUrl(params: {
  origin:      string;
  destination: string;
  outbound:    string;
  return_date: string;
  adults:      number;
  children:    number;
}): string {
  const tfs = encodeTfs([
    { origin: params.origin, dest: params.destination, date: params.outbound },
    { origin: params.destination, dest: params.origin, date: params.return_date },
  ], false);
  return `https://www.google.com/travel/flights/search?tfs=${tfs}&curr=GBP&hl=en-GB`;
}

// Generalization of buildGoogleFlightsRoundTripUrl for the modal's "Book
// these dates" button — the cheapest outbound leg and cheapest return leg
// shown in the modal can use DIFFERENT airports (e.g. Barcelona's pool
// spans BCN/GRO/Reus; nearby-airport arbitrage can pick a different one
// per leg even for a non-circuit destination — see the ret_orig_iata fix
// in get_smart_recommendation.sql for the same underlying reason). A
// symmetric round-trip builder can't represent that; this takes each
// leg's own airports explicitly instead of assuming they mirror.
export function buildGoogleFlightsMultiLegUrl(
  legs: Array<{ origin: string; dest: string; date: string }>,
): string {
  const tfs = encodeTfs(legs, false);
  return `https://www.google.com/travel/flights/search?tfs=${tfs}&curr=GBP&hl=en-GB`;
}
