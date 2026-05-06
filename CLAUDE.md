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

School data is live in Supabase. Flight data integration is in progress — API provider TBD.

---

## Data & API Architecture

| Layer | Status | Notes |
|---|---|---|
| School / borough data | ✅ Live in Supabase | Serving real data to frontend |
| Anthropic narrative generation | Pre-generate via Batch API nightly → Supabase | No Claude API calls per user visit |
| Flight data | 🔄 API provider undecided | Build behind abstraction layer — see below |
| Open-Meteo (weather) | Real-time | Free, no key required |
| FCDO (safety) | Real-time | Free API |
| Supabase | Live | Primary data store |

### Flight API Abstraction Rule
Do not hardcode any flight API provider. All flight data calls must go through
`lib/flights/fetchFlights.ts` — a single adapter function. The provider (Kiwi,
Amadeus, Duffel — TBD) will be slotted in behind this interface. UI components
import from the adapter only, never from a provider SDK directly.

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
    fetchFlights.ts                   ← all flight search calls (fares, routes, availability)
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

---

## Build Status
*Tick off as features are completed. Move the IN PROGRESS marker each session.*

- [ ] Feature 1 — Inset + School Calendar Engine
- [ ] Feature 2 — Compliance Calculus Calculator
- [ ] Feature 3 — All-in Family Cost Normalisation
- [ ] Feature 4 — Party-Size Capacity Warning
- [ ] Feature 5 — Multi-Airport London Search  ← IN PROGRESS
- [ ] Feature 6 — Open-Jaw / Split-City Search
- [ ] Feature 7 — Stopover & Long-Layover Routing
- [ ] Feature 8 — Nearby Destination Airports
- [ ] Feature 9 — Multi-Modal Routing
- [ ] Feature 10 — Rail Children-Travel-Free Intelligence
- [ ] Feature 11 — One-Way vs Return Fare Analysis
