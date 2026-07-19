# CLAUDE.md
*Claude Code reads this at session start. Update when decisions change.*

---

## What This Project Is
Holiday Smart — a decision support tool for London parents booking family holidays
within fixed school holiday windows. A Decision Support System, not a travel agency
or blog.

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

### Card set for `significant` / `found_saving` (in `getAIRecommendation.ts`)
Fixed order, built in `if (!isBaselineCheapest) { ... }`:
1. **quality_advantage** — "Why this over the alternatives". Always shows.
2. **penalty_notice** — only when `absence_days > 0`. Two variants depending on
   `fine_wipes_saving` (four sentences if the fine wipes out the saving, three if not).
3. **alternative_option** — "If you want to avoid the fine". Only when `absence_days > 0`
   AND a fine-free (or cheaper) alternative exists — this card is fine-avoidance only now,
   it no longer has a no-absence "Next best option" variant.
4. **trade-off** (`early_return` / `early_outbound` / `split_booking` / `timing_summary`) —
   "The one trade-off that matters most". `early_return` absorbed the old "Early Departure"
   sidebar notice's hotel-checkout-time and transit-home content as extra sentences.
5. **inset_day_option** — only when a cheaper inset-day combination exists in the pool and
   isn't the winner itself (via `combinationKey()` comparison).

When `absence_days === 0`, cards 2 and 3 are skipped entirely — order is just quality → trade-off
(→ inset, when it applies). `baseline_cheapest` has its own separate, unrelated card set —
untouched by any of the above.

Removed entirely from the significant/found_saving set (do not resurrect without checking why
they were cut): `split_carrier`, `transport_outbound`/`transport_return`, `selection_story`
("Why this routing"), `saving_explainer` ("How the saving works" — the problem
statement/headline/subheadline already carry that), and the old `allin_trap` "why not the
cheapest headline fare" card that used to occupy card 3's slot.

### Problem statement (significant/found_saving)
Fixed four-sentence template, pre-resolved in TypeScript (not left for the LLM to branch on):
reference point ("When half-term begins, most {borough} parents open Google Flights and search
for the first weekend...") → true cost → methodology → finding. No fine mention — that's the
penalty notice card's job now.

### Other UI pieces touched alongside the card system
- `components/flight-insights/savings-breakdown.tsx` (`SavingsBreakdown`) is now a **no-op** —
  its entire previous output was the "How we calculated your saving" expandable table, which is
  redundant with the comparison table below. Props/types kept for interface stability with
  `page.tsx`; do not delete the file or its export without also removing the `page.tsx` call site.
- `components/flight-insights/comparison-table.tsx` (`ComparisonTable`) no longer renders as its
  own page section — it's now rendered *inside* `ComplianceCalculator`, below the legend, behind
  a small text-link trigger ("How we chose these prices ↓"), via a `comparisonResult` prop.
  Column order is fixed: baseline, winner, then the rest sorted by `total_cost_gbp` ascending.
  Labels come from `deriveLabel()` — `is_baseline` is checked first, above everything else
  including `isWinner`, so the baseline column always reads "Typical Saturday" even when it's
  also the winner or its airport differs from the winner's.
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
