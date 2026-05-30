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
intelligence across 11 feature components.

School data is live in Supabase. Flight data provider confirmed: Crawlio via RapidAPI (google-flights8).
Layer 3 RPC functions: ✅ complete and validated (all 7 functions + helper deployed to Supabase).
Current task: **Task 3 — Flight Insights page UI restructure.**

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

---

### Flight API Abstraction Rule
All flight data calls must go through `lib/flights/fetchFlights.ts` — the only entry point.
Provider is Crawlio via RapidAPI (google-flights8). UI components import from the adapter only,
never from RapidAPI or Crawlio SDK directly.

---

## File Structure

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
All 7 functions + helper deployed and validated against live Supabase data.
Canonical pilot run: **39409974**.

### Task 3 — Flight Insights Page UI ← CURRENT TASK
*Tick off as components are completed.*

- [ ] Feature 1 — Inset + School Calendar Engine
- [ ] Feature 2 — Compliance Calculus Calculator
- [ ] Feature 3 — All-in Family Cost Normalisation
- [ ] Feature 4 — Party-Size Capacity Warning
- [ ] Feature 5 — Multi-Airport London Search
- [ ] Feature 6 — Open-Jaw / Split-City Search
- [ ] Feature 7 — Stopover & Long-Layover Routing
- [ ] Feature 8 — Nearby Destination Airports
- [ ] Feature 9 — Multi-Modal Routing
- [ ] Feature 10 — Rail Children-Travel-Free Intelligence
- [ ] Feature 11 — One-Way vs Return Fare Analysis
