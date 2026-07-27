# CLAUDE.md
*Claude Code reads this at session start. Update when decisions change.*

---

## What This Project Is
Holiday Smart — a decision support tool for London parents booking family holidays
within fixed school holiday windows. A Decision Support System, not a travel agency
or blog.

---

## Known Issues / Deferred Fixes

### KNOWN ISSUE — Matrix cell price may not be the true cheapest for that date pair

**Location:** `components/flight-insights/compliance-calculator.tsx`, `cellMap` construction (~line 251-255).

The matrix's per-cell price is selected via "first entry in the combinations array wins" for a
given (outbound_date, return_date) key — not "cheapest entry wins." `get_smart_recommendation`
can return multiple combinations for the same date pair (different carrier/airport routing),
and the matrix currently displays whichever happens to appear first in the array, which is not
guaranteed to be the lowest-cost option.

**Confirmed NOT the cause of a separate concern:** the modal's headline total (e.g. "£760
all-in") always matches the matrix cell exactly, since both read the same `cellMap.get()`
result (`handleCellClick`, ~line 279-294) — so there's no cell-vs-modal-headline discrepancy.

**Still unconfirmed, flagged for future investigation:** whether the modal's own two
"cheapest" per-leg tables (outbound/return, sourced independently from `get_leg_options.sql`
via `/api/leg-options`) can sum to a different total than the modal's own headline figure —
these are two separate code paths with nothing keeping them in sync, so this should be checked
before or alongside the cellMap fix.

**Fix approach (not yet implemented):** change `cellMap` construction to select the
minimum-total combination per date-pair key, not the first one encountered. Should be
low-risk/isolated once undertaken — confined to this one component's cell-selection logic.

**Priority:** this affects the accuracy of the comparison matrix, which `feature-list.md` and
`CONTEXT.md` both describe as core/non-negotiable ("without it, the product is a blog, not an
advisor"). Deferred deliberately for MVP scope, not because it's considered low-impact —
revisit before treating the matrix's numbers as fully trustworthy for real users.

**Related — modal's "Book these dates" button (added after this issue was documented):** the
button in `leg-options-modal.tsx` builds its Google Flights link from `getCheapestOption()`
(`components/flight-insights/leg-options.tsx`) applied independently to each of the outbound/
return option lists — i.e. the genuinely cheapest leg in each table, NOT the `cellMap`-selected
combination the headline total above it displays. In the common case these should coincide, but
until the `cellMap` fix above lands, it's possible for the button's target itinerary to differ
slightly from the "£X all-in" figure shown directly above it. Revisit this note once the
`cellMap` fix is done — the two should be provably identical after that.

**Confirmed NOT the cause of the matrix's colour-tier bug (see RESOLVED entry below):** traced
`DataCell` in `compliance-calculator.tsx` — the tier colour is computed as `c.total_cost_gbp -
minCost` on the *exact same* `c` object (`cellMap.get()` result) whose price the cell displays,
so the tier and the displayed price can never disagree with each other. This rules out the
`cellMap` first-wins bug as the cause of that separate symptom — it was a genuine colour-mapping
inversion instead (see below), unrelated to which combination `cellMap` selects.

---

### RESOLVED — Matrix colour tiers were inverted (cheapest cell rendered amber)

**Location:** `components/flight-insights/compliance-calculator.tsx`, `cellColour()` (~line 73)
and the `LEGEND` array (~line 205).

Introduced in commit `5cd11d9` ("Switch matrix to total_cost_gbp for display, colour coding, and
spread"), which changed the colour-tier reference point from `baselineTotal` to the grid's own
`minCost` but kept the *same* bucket→colour assignment and the *same* legend text, which had been
written for the old (opposite-signed) `baselineTotal - c.total_inc_fine` formula. Under the old
formula, a large positive value meant "much cheaper than baseline" → dark teal made sense. Under
the new `c.total_cost_gbp - minCost` formula, a value near 0 means "this cell IS the cheapest in
the grid" — but that case kept the *old* amber bucket, whose legend text read "more than cheapest
option." The single cheapest cell in the matrix (and any cell badged "Cheapest") therefore always
rendered amber, directly contradicting its own label. The hardcoded baseline-recommended cell
(~line 448, always `#0d5c63` dark teal) never went through `cellColour()` and so never showed the
bug — its independent hardcoded colour is what exposed the inconsistency.

**Fix:** reversed the bucket→colour assignment (same £1/£50/£100 thresholds, colours swapped) so
the cheapest cell gets the darkest teal and the most-expensive-relative-to-cheapest cells get
amber; updated `LEGEND` text to match ("Cheapest option" / "up to £50 more" / "£50–100 more" /
"£100+ more than cheapest").

**Still deferred, by explicit instruction:** collapsing the three teal shades into two tiers
(saving / no saving) is a separate follow-up, to be done only once this colour-direction fix is
confirmed correct against live data — not bundled into this fix.

---

### DEFERRED DECISION — Date matrix format (grid vs. sorted list) for city-type destinations

An independent design review raised that the date matrix is ~80% empty for Barcelona (a
city-type destination, restricted to 3-4 night stays within the half-term window by design) and
proposed a sorted list (date pair · nights · all-in · fine · saving vs baseline) as a better fit
for sparse grids — more scannable, shows nights natively, easier to make responsive.

This sparsity is confirmed deliberate and will be the permanent shape for every city-type
destination (not a bug, not specific to this half-term's data window).

Decision deferred, not rejected — revisit once:
1. A circuit-type destination (Andalusian Corridor, Croatia, Crete) has its date matrix live, so
   there's a real dense-grid example to compare against Barcelona's sparse one before deciding
   the format globally.
2. Mobile layout work begins for this page, since a sorted list is inherently easier to make
   responsive than a wide date grid.

Do not implement a list-view alternative without revisiting this decision explicitly first.

---

### KNOWN ISSUE — Google Flights deep links don't encode carrier or party size

**Location:** `lib/flights/googleFlightsUrl.ts` (`encodeTfs` and all three exported builders —
`buildGoogleFlightsUrl`, `buildGoogleFlightsRoundTripUrl`, `buildGoogleFlightsMultiLegUrl`).

The `tfs` protobuf schema used for these deep links only encodes origin, destination, date, and
one-way/round-trip — there is no field for airline/carrier or passenger count. A link built from
a specific carrier's fare (e.g. a Ryanair row) opens a generic Google Flights search for that
route and date; the user may land on a page where a different carrier is the top result, and
passenger count defaults to whatever Google Flights defaults to, not the family's actual party
size passed into these functions (`adults`/`children` params exist on the builders but are
currently unused inside them).

**Where this currently applies:**
- The matrix modal's "Book these dates" button (`leg-options-modal.tsx`) already carries an
  explicit disclaimer next to it: "Opens Google Flights for these dates — confirm the airline
  and price match before booking."
- The top-section booking box's "Book on Google Flights" button (`ai-recommendation-client.tsx`)
  has the **same underlying limitation but no equivalent disclaimer yet** — flagged here, not
  fixed, per explicit instruction when this was raised. Should get the same treatment at some
  point.

**Fix approach (not yet implemented, and not obviously worth it):** either add the same
disclaimer copy near the top-section Book button, or investigate whether Google Flights' actual
`tfs` protobuf supports an airline-filter field that this reverse-engineered schema hasn't
captured (the Google Flights UI itself does support airline filtering, so the field likely
exists — untested here).

---

## Current Build Phase
**Phase 1 — Flight Insights results page.**
A parent has selected their borough and school break. The page surfaces flight
intelligence across 11 feature components, plus an AI-written recommendation
card system (headline, subheadline, problem statement, insight cards) driven
by `getAIRecommendation.ts` that sits above them.

School data is live in Supabase. Flight data provider confirmed: Crawlio via RapidAPI (google-flights8).
Layer 3 RPC functions: ✅ complete and validated (all 7 functions + helper deployed to Supabase),
plus `get_smart_recommendation` and `get_leg_options` — see the RPC table below, both were
previously undocumented here despite being what the live results page actually calls.
Current task: **Iterative refinement of the AI recommendation card system and results-page
layout** — problem statement / headline copy, the significant/found_saving 5-card set, the
comparison table, and the date matrix. See "AI Recommendation Card System" below for the
current architecture; it changed substantially in the most recent work and this doc had not
been updated to match until now.

⚠️ The `components/flight-insights/` and `lib/flights/` file listings further down predate a
lot of the actual build — several files exist under different names than documented (e.g. no
`inset-calendar.tsx`; there's `SchoolCalendarSection.tsx` instead). Run `ls` on those
directories rather than trusting the stale list below for anything not called out explicitly
in this update.

---

## Data & API Architecture

| Layer | Status | Notes |
|---|---|---|
| School / borough data | ✅ Live in Supabase | Serving real data to frontend |
| Anthropic narrative generation | Pre-generate via Batch API nightly → Supabase | No Claude API calls per user visit |
| Flight data | ✅ Crawlio via RapidAPI | google-flights8, $9/month, RAPIDAPI_KEY env var |
| Layer 3 RPC functions | ✅ Complete and validated | 7 functions + calculate_absence_fine helper |
| Baseline snapshots | ✅ Live in Supabase | 12 rows — canonical pilot run 39409974 |
| Open-Meteo (weather) | Real-time | Free, no key required |
| FCDO (safety) | Real-time | Free API |
| Supabase | Live | Primary data store |

### Layer 3 — RPC Functions (Complete)

All 7 functions deployed to Supabase. Shared helper `calculate_absence_fine` used by functions 1 and 2.
Transit data sourced from `district_airport_transit` keyed by `postcode_district` (not `school_airport_transit`).

| # | Function | Key parameters |
|---|---|---|
| 1 | `get_savings_breakdown` | `p_destination_slug, p_school_urn, p_window_start, p_window_end, p_trip_type, p_adults, p_children, p_infants` |
| 2 | `get_compliance_scenarios` | `p_destination_slug, p_school_urn, p_trip_type, p_adults, p_children, p_infants` |
| 3 | `get_allin_flight_cost` | `p_destination_slug, p_school_urn, p_outbound_date, p_return_date, p_adults, p_children, p_infants, p_transport_mode` |
| 4 | `get_multi_airport` | `p_destination_slug, p_school_urn, p_outbound_date, p_return_date, p_adults, p_children, p_infants` |
| 5 | `get_open_jaw` | `p_destination_slug, p_school_urn, p_outbound_date, p_return_date, p_adults, p_children, p_infants` |
| 6 | `get_nearby_destination_airports` | `p_destination_slug, p_school_urn, p_outbound_date, p_return_date, p_adults, p_children, p_infants` |
| 7 | `get_bucket_split` | `p_destination_slug, p_origin_iata, p_outbound_date, p_return_date, p_adults, p_children, p_infants` |
| — | `calculate_absence_fine` (helper) | `p_dep_date, p_ret_date, p_window_start, p_window_end, p_school_urn, p_adults, p_children` |

`get_savings_breakdown` self-discovers optimal dates from `fare_snapshots` — callers pass `p_window_start/end` and `p_trip_type` ('circuit' | 'city'), not fixed dates or duration.
`get_compliance_scenarios` derives its own date window from fare data; `p_trip_type` drives the departure/return candidate range and min/max nights.

### Two more RPCs the results page actually depends on (previously undocumented here)

| Function | Key parameters | Called from |
|---|---|---|
| `get_smart_recommendation` | `p_destination_slug, p_school_urn, p_trip_type, p_adults, p_children, p_infants, p_cabin_bags, p_checked_bags, p_seats_together` | `app/results/flight-insights/page.tsx` (initial render) and `app/api/recommend/route.ts` (the AI recommendation call) |
| `get_leg_options` | see `app/api/leg-options/route.ts` | Leg-options modal (per-leg fare breakdown when a matrix cell is clicked) |

`get_smart_recommendation` returns both the full `combinations` grid and the `baseline` object.
Its baseline-selection logic picks the origin airport by nearest transit time between LHR/LGW
for the school's `postcode_district` (via `district_airport_transit`), falling back to LHR —
it does **not** hardcode LHR as of the most recent change. It also returns `absence_out_days`
and `absence_ret_days` per combination (departure-side vs return-side absence), not just the
combined `absence_days` — see "AI Recommendation Card System" below for why that split matters.

---

### Flight API Abstraction Rule
All flight data calls must go through `lib/flights/fetchFlights.ts` — the only entry point.
Provider is Crawlio via RapidAPI (google-flights8). UI components import from the adapter only,
never from RapidAPI or Crawlio SDK directly.

---

## AI Recommendation Card System

### ⚠️ Live path vs dead code — check this before editing anything here
`lib/flights/assembleRecommendation.ts` exports an `assembleRecommendation()` function that
builds a `FamilyContext` and calls `getAIRecommendation()` — **it is never called anywhere in
the app.** The page (`app/results/flight-insights/page.tsx`) calls `assembleCombinationsOnly()`
directly for the server-rendered grid, and the actual AI recommendation is fetched client-side
by `AIRecommendationClient` via `fetch('/api/recommend')`, which hits
**`app/api/recommend/route.ts`** — that route builds its own `FamilyContext` inline and is the
one that matters. Both files are kept in sync (same fields, same computation), but if you only
have time to change one, change `route.ts` — that's what users actually see. This wasn't
discovered until partway through a long session of card-system work; don't rediscover it the
hard way.

### FamilyContext (in `getAIRecommendation.ts`)
Built in both `route.ts` and `assembleRecommendation.ts`. Beyond the original fields, it now
also carries:
- **Fine/absence**: `absence_days`, `absence_out_days` (departure before the window opens),
  `absence_ret_days` (return after the window closes), `fine_gbp`, `fine_wipes_saving`,
  `net_cost_with_fine`, `net_delta_with_fine`, `term_resume_date` (window_end + 1 day,
  formatted "Monday 3 Nov").
- **Best alternative** (`alt_*`): the best combination in the scored pool that avoids the fine
  when the winner has one, otherwise just the runner-up. Computed via `combinationKey()`
  matching against the winner, sorted by `effectiveCost()`. Carries cost, dates, carriers
  (raw IATA — humanised at render time via `cn()`, not pre-joined into a string), quality
  fields, and absence/fine status.
- **Quality comparison** (`winner_*`, `baseline_out_dep_time`, `alt_out_dep_quality` etc.):
  departure/arrival times and quality tiers for winner, baseline, and the alternative, plus a
  pre-computed `winner_quality_advantage` (`'departure_vs_baseline' | 'arrival_vs_alternative'
  | 'return_vs_alternative' | 'cost_driven'`) picking the single most meaningful contrast.

### Card headings — heading register per card, and a note on icons
Headings deliberately do **not** use one uniform grammatical template across all cards. Each
card's register matches its icon (`LEVER_ICONS` in `ai-recommendation-client.tsx`) — pulling
every heading toward the same declarative structure would undercut the icon-differentiation work
from an earlier round (distinct icons signalling distinct *kinds* of information). Specifically:
- **quality_advantage** stays in question form — `"Why this over the alternatives"` — its
  lightbulb icon is deliberately the odd one out, and the interrogative heading reinforces that
  "this card works differently" signal rather than blending in. **Do not** change this to a
  declarative heading, and specifically **never** to anything implying this is the raw cheapest
  option (e.g. "Cheapest once transport is counted") — the recommendation is chosen on
  quality-adjusted value, not raw price; a genuinely cheaper combination can exist via a
  different carrier (see the price-history fixes distinguishing "recommended" from "cheapest for
  these dates" — reintroducing "cheapest" language here would reopen that exact confusion). If a
  declarative alternative is ever wanted, it must describe value, not price — e.g. "Best value
  once quality is weighed" — but the current form was reconfirmed as the better choice.
- **penalty_notice**, the three trade-off levers, and **inset_day_option** are declarative and
  each name their specific trigger in the heading itself (see below) — so the body never needs a
  redundant clause just to say what's being flagged. Before adding a trigger clause to any card's
  body, check whether the heading already states it; only add one where it doesn't.
- **Cheapest/cheaper language is heading-by-heading, not a blanket rule** — check the actual
  gating condition before writing a heading, the way `inset_day_option` below does. It is only
  ever safe to say when that specific card's own gate guarantees it.

### Card set for `significant` / `found_saving` (in `getAIRecommendation.ts`)
Fixed order, built in `if (!isBaselineCheapest) { ... }`:
1. **quality_advantage** — "Why this over the alternatives". Always shows.
2. **penalty_notice** — only when `absence_days > 0`. Single merged card (lever
   `penalty_notice`) — as of this update it absorbs what used to be a separate
   `alternative_option` card ("If you want to avoid the fine"); see below for why they were
   merged. Headline is now dynamic and states the stake directly: `"This trip misses {N}
   school day(s) — £{fine_gbp} if your school fines you"` (previously the static, procedurally
   neutral "Penalty notice"). Two variants:
   - **Fine-free alternative exists** (`alt_total_cost != null`): three sentences — which days
     are missed, then a dual-basis comparison sentence stating the fine-free alternative's cost
     against BOTH the no-fine winner total AND the fine-inclusive winner total explicitly (see
     below), then the plain disclaimer.
   - **No fine-free alternative exists**: three sentences — which days are missed, net
     cost/saving after the fine (branches on `fine_wipes_saving`), then the same disclaimer.
   - Disclaimer sentence (both variants): `"We're not recommending unauthorised absence — you
     should know the numbers before you book."` — **do not** prepend "Schools apply this
     inconsistently" or similar back to this; a prior version had that clause immediately
     before the disclaimer and it read as "you'll probably get away with it" directly
     contradicting the disclaimer one sentence later. Cut entirely, not reworded.
   - **Why merged, and why "dual-basis" is now the standing rule**: the old two-card version
     picked a different cost basis in each card without saying so — the penalty notice compared
     the fine-*inclusive* winner total against baseline, while the separate alternative-option
     card compared the fine-*free* alternative against the fine-*exclusive* winner total. Both
     comparisons happened to make the recommendation look better, and nothing on the page ever
     stated that the two bases disagree on which option is actually cheaper (a real case: winner
     £440 no-fine / £760 with-fine; alternative £583 flat — the alternative is £143 *more* than
     the no-fine comparison but £177 *less* than the fine-inclusive one). Whenever a fine-free
     alternative exists, state both comparisons side by side and let the reader pick the basis
     that matches their own school's enforcement — never silently pick one. Apply this same
     dual-basis pattern to any future absence-day trade-off copy, not just this card.
   - Also removed (do not resurrect): the old alternative-option card's closing editorial line
     `"The price gap is significant — worth checking the date matrix to see if it fits your
     window"` — it editorialised against the product's own alternative and the "if it fits"
     framing was a non-answer given the date was already known to fit and already priced into
     the comparison table.
3. **trade-off** (`early_return` / `early_outbound` / `split_booking`) — only when one of the
   three trigger conditions actually applies; **no card at all otherwise.** Each lever has its own
   heading naming the specific trigger — `"Early return — plan around it"` / `"Early departure"` /
   `"Two separate bookings"` — replacing the old shared, generic `"The one trade-off that matters
   most"` (dropped "the one" to stop claiming singularity, and made each heading trigger-specific
   so the body doesn't need a redundant clause restating it). The old `timing_summary` fallback
   lever — which rendered a card even when nothing about the timing was actually noteworthy, just
   restating ordinary arrival/return times under the same vague heading — is deleted, not
   reworded: a card that can't say why it exists shouldn't render. Confirmed safe: `nonBaselineCards`
   was already a variable-length array (cards 2 and 4 are each independently conditional too), and
   nothing downstream (`lever_insights`, the `price_movement` splice, the client's
   `timelineCards.map`) assumes a fixed card count. `early_return` absorbed the old "Early
   Departure" sidebar notice's hotel-checkout-time and transit-home content as extra sentences.
4. **inset_day_option** — only when a cheaper inset-day combination exists in the pool and
   isn't the winner itself (via `combinationKey()` comparison) — `showInsetCard`'s own gate is a
   strict `<` on total cost, which is what makes "cheaper" heading language safe specifically for
   this card. Heading is `"The cheaper inset-day option"` (previously the neutral "Inset day
   option" — made declarative and cheaper-referencing since the gate guarantees it's true).
   `LEVER_ICONS` maps this lever to `'event_available'` — previously fell through to the
   `'lightbulb'` default (shared with quality_advantage, despite being an unrelated kind of
   card); now distinct from both that and the trade-off cards' `'schedule'` icon.

When `absence_days === 0`, card 2 is skipped entirely; when none of the three trade-off triggers
apply, card 3 is skipped too — order is just whatever subset of quality → penalty → trade-off →
inset actually has something to say, quality_advantage being the only one that always shows.
`baseline_cheapest` has its own separate, unrelated card set — untouched by any of the above.

Removed entirely from the significant/found_saving set (do not resurrect without checking why
they were cut): `split_carrier`, `transport_outbound`/`transport_return`, `selection_story`
("Why this routing"), `saving_explainer` ("How the saving works" — the problem
statement/headline/subheadline already carry that), the old `allin_trap` "why not the
cheapest headline fare" card that used to occupy card 3's slot, and (as of this update) the
standalone `alternative_option` card — folded into `penalty_notice`, see above.

### Problem statement (significant/found_saving)
Fixed sentence template, pre-resolved in TypeScript (not left for the LLM to branch on):
reference point ("The obvious way to book {borough}'s half-term is the first Saturday —
{date} from {airport}...") → true cost → methodology → finding. No fine mention — that's the
penalty notice card's job now. (Earlier version above was itself stale — it still showed a
since-replaced "When half-term begins, most {borough} parents..." wording that invented an
unmeasured behavioural claim and described searching for flights at a point when it's already
too late to book well; replaced for both reasons, not just tone.)

### Shared copy constants (`lib/flights/copyConstants.ts`)
Two page-wide strings previously duplicated (with drifting wording) across five-plus locations
each — centralised so a future wording change only happens in one place:
- **`ALL_IN_DEFINITION`** — `"All-in = fare + bags + seats + transport to and from both
  airports."` Rendered exactly once, directly under the subheadline
  (`ai-recommendation-client.tsx`). Every other mention of cost inclusions on the page — problem
  statement, subheadline itself, "Why this over the alternatives" card, both price-history
  subtitles, the modal subtitle, the matrix subtitle, the leg-options "Best option" line — says
  the bare word **"all-in"** and relies on this definition rather than restating "bags, transit
  and transfers" (or any close variant) each time. Do not re-add an inline explanation next to
  "all-in" anywhere else; if the definition itself needs to change, change it only here.
- **`BASELINE_NAME`** (`"the typical Saturday booking"`) and **`BASELINE_NAME_LABEL`**
  (`"Typical Saturday Booking"`, Title Case for compact UI contexts like the comparison table's
  column header, kept in sync with `BASELINE_NAME` by hand) — the comparison baseline (a direct
  BA flight on the first Saturday of half-term) used to be called four different things across
  the headline ("the standard Saturday booking from Heathrow"), booking box ("the typical
  booking" / "a typical Saturday Heathrow booking" — two different variants in the same file),
  penalty card ("the Saturday booking"), and comparison table ("Typical Saturday"). All four now
  import and reference the shared constant instead of hardcoding their own phrasing — including
  the AI headline prompt's own RULES section, which now instructs the model to use
  `BASELINE_NAME` verbatim rather than picking between "typical booking"/"standard booking"/"the
  obvious option."

### Other UI pieces touched alongside the card system
- `components/flight-insights/savings-breakdown.tsx` (`SavingsBreakdown`) is now a **no-op** —
  its entire previous output was the "How we calculated your saving" expandable table, which is
  redundant with the comparison table below. Props/types kept for interface stability with
  `page.tsx`; do not delete the file or its export without also removing the `page.tsx` call site.
- `components/flight-insights/comparison-table.tsx` (`ComparisonTable`) is rendered as its own
  standalone section in `page.tsx`, positioned directly **below** `<ComplianceCalculator>` (not
  passed in as a prop, not nested inside it — nesting was tried and reverted earlier because no
  JSX reordering inside `ComplianceCalculator` can place content above its own hardcoded H2;
  the below-matrix position was reached by swapping the two sibling sections in `page.tsx`, not
  by revisiting that nesting attempt). Moved below the matrix because "How we chose these
  prices" has no antecedent when it renders before any prices are shown. **No longer has a
  disclosure trigger at all** — an earlier pass made it default-open but kept a toggle button
  ("Hide how we chose these prices ↑" / show), which still read as an expander; the toggle has
  since been removed entirely and replaced with a plain, non-interactive small heading (`13px`,
  `Inter`, uppercase, `#004349`) — the table always renders, since this is the strongest
  evidence on the page and there's nothing left to disclose.
  Column order is fixed: baseline, winner, then the rest sorted by `total_cost_gbp` ascending.
  Labels come from `deriveLabel()` — `is_baseline` is checked first, above everything else
  including `isWinner`, so the baseline column always reads "Typical Saturday" even when it's
  also the winner or its airport differs from the winner's. The "Checked bags"/"Seats" rows
  render as a merged, left-aligned "Same for all" band (tinted background, explicit tag) when
  uniform across columns — not centred grey text spanning every column, which read as an
  empty/error state.
- `components/flight-insights/price-history-section.tsx` has its own matching small heading
  ("Price history", same `13px`/`Inter`/uppercase/`#004349` treatment as "How we chose these
  prices" above it) followed by the intro sentence, then sits behind its own collapsed-by-
  default expander ("See how the price has moved ↓") — the inverse of the comparison table
  above, since this is chart-based supporting detail, not the page's strongest evidence.
  Clicking a different matrix cell or closing the leg-options modal auto-expands it (in addition
  to switching to the "These dates" tab and pulsing), so the update is never hidden behind a
  still-collapsed section. Vertical rhythm below the matrix is a consistent 48px between
  sections — `page.tsx`'s wrapper around `<ComparisonTable>` carries `marginTop: 24` (on top of
  `ComplianceCalculator`'s own 24px bottom padding) to reach 48px, since `ComparisonTable` and
  `PriceHistorySection` both render with no self-padding of their own.
  **Closing line is deterministic, not AI-generated** — every price-history card (this section's
  two tabs, and the top-section `price_movement` card in `ai-recommendation-client.tsx`) ends
  with a line built by `buildPriceRangeLine()` (`lib/flights/priceMovement.ts`), stating the
  current price's exact position within the observed range with identical structure and weight
  every time: series low, series high, or neither. A prior version relied on an AI-narrated
  and/or conditionally-rendered takeaway ("it's never been cheaper than it is right now") that
  only ever appeared in the favourable case — a structurally biased instrument regardless of how
  the sentence was worded. `computePriceMovement()` now also returns `range_low_gbp` /
  `range_high_gbp` / `price_position`, and the shared narration prompt
  (`PRICE_MOVEMENT_SYSTEM_PROMPT`) has hard rules forbidding the AI narration from (a) claiming
  the price "held steady"/"stabilised"/"settled" off a handful of checks (an implicit forecast
  the data can't support) and (b) making any "never been cheaper/lower" style claim itself, since
  the deterministic line already owns that comparison. Beneath that, every price-history card
  also carries one hardcoded, always-present standing line — `PRICE_MOVEMENT_STANDING_LINE`,
  "We don't predict where prices go next." — never AI-generated, never conditional.
  **`lib/flights/priceMovement.ts` vs `lib/flights/priceMovementNarration.ts` — client/server
  split, do not merge back together.** `priceMovement.ts` holds only pure, dependency-free
  computation (`computePriceMovement`, `buildPriceRangeLine`, the `PriceMovement*`/`PriceRange*`
  types, `PRICE_MOVEMENT_STANDING_LINE`) and is safe to import from client components —
  `price-history-section.tsx` and `ai-recommendation-client.tsx` both do, to render the
  deterministic range line above without a round trip. `priceMovementNarration.ts` holds
  `narratePriceMovement` and `PRICE_MOVEMENT_SYSTEM_PROMPT`, imports `@anthropic-ai/sdk`, and is
  **server-only** — only ever import it from API routes (`cell-price-history`,
  `destination-price-history`) or `getAIRecommendation.ts`, never from a `'use client'` file.
  These were one file until a Vercel build broke with "Reading from node:child_process /
  node:crypto / node:fs/promises / node:fs / node:path is not handled by plugins": the first time
  a client component did a plain value-import from the combined file (to reuse
  `computePriceMovement`/`buildPriceRangeLine` for the range-line work above), webpack pulled the
  whole module — including its top-level `import Anthropic from '@anthropic-ai/sdk'` — into the
  browser bundle, and the SDK's Node-only dependencies aren't polyfillable. `import type` from the
  combined file was always safe (erased at compile time, which is why nothing broke for the
  months this was one file); a plain value-import was the trigger. If either file grows again,
  keep the SDK import strictly confined to `priceMovementNarration.ts`.
- `components/flight-insights/compliance-calculator.tsx` (`ComplianceCalculator`, the date
  matrix) no longer has its own card chrome (white bg/rounded/shadow) — renders full-width
  directly on the page background. The dedicated grey "Baseline" cell and the "Typical Saturday
  booking: ..." reference line above the matrix are both gone; the baseline's date position
  renders as an ordinary cell like any other.
- `components/flight-insights/ai-recommendation-client.tsx`: the "Early Departure" sidebar
  notice and the "This trip includes X school days of absence..." sidebar notice are both
  deleted (content moved into the trade-off and penalty notice cards respectively). The
  "SMART TRIP" / "Best All-In Price" badge is suppressed entirely when the fine wipes out the
  saving, and relabelled "Saving Found" when absence is involved but the saving survives.

---

## File Structure

**⚠️ Verified stale as of this update** — `lib/schools/`, `lib/safety/`, `lib/weather/` do not
exist (no `getSchoolWindows.ts`/`getFCDO.ts`/`getWeather.ts`; the school lookup that exists is
inline in `page.tsx` as a direct `all_schools` query, not a lib helper). `fetchAirports.ts`
also doesn't exist in `lib/flights/`. The `components/flight-insights/` tree below has grown
well beyond this list (mixed naming conventions — some `PascalCaseSection.tsx`, some
`kebab-case.tsx`, occasional near-duplicates like `all-in-cost.tsx` alongside `allin-cost.tsx`)
and the Feature-N mapping shown here has not been confirmed against the real files. Treat this
block as historical/aspirational, not authoritative — run `ls components/flight-insights/
lib/flights/` to see what's actually there.

```
app/
  results/
    flight-insights/
      page.tsx                        ← composes all 11 feature components
components/
  flight-insights/
    inset-calendar.tsx                ← Feature 1
    compliance-calculator.tsx         ← Feature 2
    all-in-cost.tsx                   ← Feature 3
    capacity-warning.tsx              ← Feature 4
    multi-airport.tsx                 ← Feature 5
    open-jaw.tsx                      ← Feature 6
    stopover-routing.tsx              ← Feature 7
    nearby-airports.tsx               ← Feature 8
    multimodal-routing.tsx            ← Feature 9
    rail-children-free.tsx            ← Feature 10
    one-way-vs-return.tsx             ← Feature 11
lib/
  flights/
    fetchFlights.ts  ← Crawlio adapter. ONLY entry point for flight data.
                       Never import RapidAPI or Crawlio SDK directly elsewhere.
    fetchAirports.ts                  ← airport metadata, transfer costs
  schools/
    getSchoolWindows.ts               ← school/borough queries (live, Supabase)
  safety/
    getFCDO.ts                        ← FCDO safety advisories
  weather/
    getWeather.ts                     ← Open-Meteo historical data
types/
  flight.ts                           ← shared UI types
FlightInsights.md                     ← design tokens — read before any UI work
CONTEXT.md                            ← full product context
CLAUDE.md                             ← this file
```

### Which lib files each feature needs

| Feature | fetchFlights | fetchAirports | getSchoolWindows | getFCDO | getWeather |
|---|---|---|---|---|---|
| 1 — Inset Calendar | | | ✅ | | |
| 2 — Compliance Calculator | ✅ | | ✅ | | |
| 3 — All-in Cost | ✅ | | | | |
| 4 — Capacity Warning | ✅ | | | | |
| 5 — Multi-Airport Search | ✅ | ✅ | | | |
| 6 — Open-Jaw Search | ✅ | ✅ | | | |
| 7 — Stopover Routing | ✅ | | | | |
| 8 — Nearby Airports | ✅ | ✅ | | | |
| 9 — Multi-Modal Routing | ✅ | ✅ | | | |
| 10 — Rail Children-Free | | | | | |
| 11 — One-Way vs Return | ✅ | | | | |

Only read the lib files marked for the feature you are currently building.

---

## Design Rules
Read `FlightInsights.md` before writing any UI component. Summary:
- **Fonts:** Newsreader for h1–h3. Inter for body, labels, data.
- **Background:** `#f8fafa`. Cards: `#ffffff` + shadow `rgba(13,92,99,0.08)`.
- **Primary:** Deep Teal `#004349`. Accent: Amber `#fdba49` (sparingly).
- **Radius:** Cards `rounded-lg` (16px). Buttons/inputs `rounded-md` (12px).
- **Spacing:** 48px between major sections. 24px card padding.
- **Tone:** Quiet cleverness. No stock-photo energy. No aggressive CTAs.

---

## Stack
- Next.js 14 (App Router)
- shadcn/ui + Tailwind
- Supabase (live)
- Resend (not yet wired)

---

## Hard Rules
- No Claude/Anthropic API calls per user visit — pre-generate nightly via Batch API → Supabase.
- No Volatility Score feature. Ever.
- No itinerary builder in Phase 1.
- All flight calls go through `lib/flights/fetchFlights.ts` — never direct to a provider SDK.
- Read `FlightInsights.md` before writing any UI component.
- Check in after each component is complete before proceeding to the next.
- Read from `destination_airports`, never `destination_legs` (table dropped).
- Transit data from `district_airport_transit` keyed by `postcode_district` — never `school_airport_transit`.
- Use LON as origin city code for all London-side queries — not individual airport codes.
- 4 family compositions per run: 1A+1C, 2A+1C, 2A+2C, 2A+1inf.
- Sort all Crawlio calls by price, not Google default ranking.

---

## Build Status

### Layer 3 — RPC Functions ✅ Complete
All 7 functions + helper deployed and validated against live Supabase data, plus
`get_smart_recommendation` and `get_leg_options` (see RPC section above).
Canonical pilot run: **39409974**.

### Task 3 — Flight Insights Page UI
**⚠️ Verified as of this update: `app/results/flight-insights/page.tsx` only imports
`SavingsBreakdown` (now a no-op — see AI Recommendation Card System above),
`ComplianceCalculator`, `PreferencesCard`, `AIRecommendationClient`, `FlightInsightsProvider`,
and `ScenarioStrip`.** Component files exist in `components/flight-insights/` for most/all of
Features 1, 3–11 (e.g. `CapacityWarningSection.tsx`, `MultiAirportSection.tsx`,
`OpenJawSection.tsx`, `StopoverSection.tsx`, `NearbyAirportsSection.tsx`,
`MultiModalSection.tsx`, `RailChildSection.tsx`, `OneWayReturnSection.tsx`,
`SchoolCalendarSection.tsx`) but **none of them are imported by `page.tsx` or by
`AIRecommendationClient`** — they are not currently rendered anywhere on the live results page.
Whether that's intentional (superseded by the AI recommendation card system + date matrix) or
an unfinished wiring step is unconfirmed — check with whoever owns product direction before
assuming either. Only Feature 2 (Compliance Calculus Calculator, `compliance-calculator.tsx`)
is confirmed live, and it has had substantial rework this session (see above).

*Tick off only once a feature is confirmed both built AND rendered on the live page.*

- [ ] Feature 1 — Inset + School Calendar Engine (file may exist as `SchoolCalendarSection.tsx` — not wired in)
- [x] Feature 2 — Compliance Calculus Calculator (`compliance-calculator.tsx` — live, reworked this session)
- [ ] Feature 3 — All-in Family Cost Normalisation (file may exist — not wired in)
- [ ] Feature 4 — Party-Size Capacity Warning (file may exist as `CapacityWarningSection.tsx` — not wired in)
- [ ] Feature 5 — Multi-Airport London Search (file may exist as `MultiAirportSection.tsx` — not wired in)
- [ ] Feature 6 — Open-Jaw / Split-City Search (file may exist as `OpenJawSection.tsx` — not wired in)
- [ ] Feature 7 — Stopover & Long-Layover Routing (file may exist as `StopoverSection.tsx` — not wired in)
- [ ] Feature 8 — Nearby Destination Airports (file may exist as `NearbyAirportsSection.tsx` — not wired in)
- [ ] Feature 9 — Multi-Modal Routing (file may exist as `MultiModalSection.tsx` — not wired in)
- [ ] Feature 10 — Rail Children-Travel-Free Intelligence (file may exist as `RailChildSection.tsx` — not wired in)
- [ ] Feature 11 — One-Way vs Return Fare Analysis (file may exist as `OneWayReturnSection.tsx` — not wired in)
