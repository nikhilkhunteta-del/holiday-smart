# Holiday Smart — Project Context
*Read this at the start of every new chat. Update when decisions change.*

Last updated: May 2026 (post Phase A validation)

---

## What It Is

A financial intelligence tool that treats school holiday pricing premiums as market inefficiencies to be exploited. Shows London parents where they are overpaying and which routes are mispriced in their favour.

**Positioning:** Not a travel agency. Not a blog. Not a comparison site. A Financial Intelligence Tool.
**Target user:** London-based parents with school-age children. Value-conscious. Research-fatigued. Locked into fixed school holiday windows.
**Distribution:** Word-of-mouth via Mumsnet, school WhatsApp groups, Mom's Night.
**Moat:** Hyper-local borough school data (exact inset days, borough-specific fines) + temporal actuarial intelligence (P(Rain) for exact windows, historical booking patterns, no prediction risk) + true family cost (headline fare + baggage + party-size optimisation — what comparison sites omit).

---

## User Flow

1. **Landing page** — parent enters school name.
2. **Borough confirmation** — infer borough from school, parent confirms.
3. **Inset Day Reveal** — show exact window including inset days. First payoff moment. Show estimated saving from inset-day departure arbitrage (£120–180 per adult).
4. **Family composition** — number of adults, children (with ages), infants. Collected here so leaderboard can be priced correctly. *(Design tweak deferred — currently on Flight Insights page; move to landing page flow in a later sprint.)*
5. **Duration question** — full window (7–10 days, circuits) or short break (3–4 days within the window, cities)?
6. **Arbitrage Leaderboard** — financial ranking of destinations sorted by net saving. Each entry is a teaser card: baseline cost, smart price, yield, blurred "how." Unlocks on email capture.
7. **Flight Insights Page** — parent clicks into a destination for the full financial breakdown.

---

## Destinations (Phase 1 — Locked)

### Circuits (9)
Fly-drive or multi-point. Priced as two one-way legs (outbound + return stored separately).

| # | Name | Outbound → Return airports | Best windows |
|---|---|---|---|
| 1 | Andalusian Corridor, Spain | LGW→SVQ / AGP→LGW | May, October |
| 2 | Algarve, Portugal | LGW→FAO / FAO→LGW | All half-terms |
| 3 | Tuscany, Italy | LGW→PSA or FLR / return | May, October |
| 4 | Apulia (Puglia), Italy | LGW→BRI / BDS→LGW | May, October |
| 5 | French Riviera, France | LGW→NCE / NCE→LGW | May, October |
| 6 | Crete, Greece | LGW→CHQ / HER→LGW | May, October |
| 7 | Catalonia, Spain | LGW→BCN / BCN→LGW | May, October |
| 8 | Croatia | LGW→SPU / DBV→LGW | May, October |
| 9 | Porto, Portugal | LGW→OPO / OPO→LGW | All half-terms |

### Cities (10)
Single-base breaks.

| # | City | Airport(s) |
|---|---|---|
| 1 | Rome, Italy | FCO or CIA |
| 2 | Barcelona, Spain | BCN |
| 3 | Lisbon, Portugal | LIS |
| 4 | Amsterdam, Netherlands | AMS |
| 5 | Copenhagen, Denmark | CPH |
| 6 | Munich, Germany | MUC |
| 7 | Vienna, Austria | VIE |
| 8 | Venice, Italy | VCE or TSF |
| 9 | Porto, Portugal | OPO |
| 10 | Seville, Spain | SVQ |

### Resorts (2)

| # | Destination | Airport |
|---|---|---|
| 1 | Gran Canaria, Spain | LPA |
| 2 | Malta | MLA |

---

## Phase 1 — Flight Insights Page: Active Features

### 1. Inset Calendar Engine
Visualises exact holiday window with inset days. Highlights departure-day arbitrage.
Example: "Bexley schools close Thursday. Flying Thursday instead of Saturday saves £180 per adult."

### 2. Compliance Calculator
Fine offset: "Saving: £1,000. Fine: £320. Net gain: £680."
Borough-specific fine amounts and escalation rules. (We do not recommend unauthorised absence.)
*Research task: verify current penalty notice structure post August 2024 standardisation.*

### 3. All-in Family Cost (Itemised, Not a Single Number)
Flight (observed, timestamped) + accommodation (curated estimate, sourced) + daily spend (curated estimate, sourced). Each component labelled: observed vs estimated, with audit trail.

### 4. Hub-Routing Optimizer
Single optimised routing recommendation + matrix showing every airport combination checked and net saving (after ground transport cost). Ground transport toggle: Drive+Park / Drive+Drop-off / Public Transport.

### 5. Inventory Bucket Splitter
*(Deferred to separate lightweight job post-pilot — not in cross-sectional run v1)*
Checks whether 2+2 booking beats 4 seats in a higher fare bucket.

### 6. Baggage True-Cost Calculator
Compares bare-fare + à la carte bags vs. upgraded fare with bags included.
**Source: curated `airline_baggage_fees` table only. SearchAPI.io returns nothing useful for baggage. Do not attempt to parse baggage from API responses.**
Carriers: Ryanair (FR), easyJet (U2), Wizz (W6), Vueling (VY), TAP (TP), BA (BA).

### 7. P(Rain) for Exact Window
*(Deferred — build after flight layer)*

### 8. Historical Booking Window
Two-tier: Tier 1 (launch) cites published industry research. Tier 2 uses own tracer snapshot data once 8–10 weeks of accumulation have passed. Do not claim Tier 2 precision prematurely.

---

## Data Architecture — Three Layers

### Core principles

**Fare snapshots are borough-independent.** Flights from London cost the same regardless of borough. Borough only affects: window dates, inset-day saving, fine amount, ground transport cost. Keep the API-metered layer borough-blind. Borough explosion happens only in the cheap derived layer.

**The matrix is backwards from savings levers.** Every query dimension must map to a way a family saves money.

| Dimension | Savings lever |
|---|---|
| Origin airport (LHR/LGW/STN/LTN/LCY) | Airport arbitrage — net of ground transport |
| Destination airport | Destination airport arbitrage |
| Outbound date (±2 days around window) | Inset-day / departure-day arbitrage |
| Return date (±2 days around window end) | Flexibility arbitrage |
| Trip type (one-way legs / open-jaw) | Best combination, mixed carriers |
| Round-trip for eligible carriers | One-way vs return comparison (Feature 11) |
| Repeated snapshots over time | Booking timing lead-time curve |

---

### Layer 1 — Reference Data (hand-curated, slow-changing)

**Status:**
- Borough term dates: ✅ live in Supabase
- Inset days (~hundreds of schools): ✅ live in Supabase
- Schools database (~1,000+): ✅ live in Supabase
- Transport cost matrix (199 districts × 5 airports): ✅ live in Supabase
- `airports` table: ✅ seeded in Supabase (all London origins + European destinations)
- `destinations` table: ✅ created in Supabase
- `destination_legs` table: ✅ created in Supabase
- `snapshot_runs` table: ✅ created in Supabase
- `airline_baggage_fees` table: ✅ created in Supabase — **needs manual data entry for FR, U2, W6, VY, TP, BA**
- `fare_snapshots` table: ✅ created in Supabase

**Still to populate:**
- `destinations` — seed 21 destination rows
- `destination_legs` — seed leg pairs per destination
- `airline_baggage_fees` — hand-enter baggage fee data per carrier

---

### Layer 2 — Observations (machine-collected, append-only, never overwritten)

**`fare_snapshots`** — one row per flight option returned by SearchAPI.io for one leg.

Key fields (see data-model.md for full schema):
- `run_id` — links to snapshot_runs
- `snapshot_type` — 'cross_sectional' | 'tracer'
- `observed_at` — timestamp (non-negotiable)
- `origin_iata`, `destination_iata`, `departure_date`
- `return_date` — NULL for one_way rows, populated for round_trip_confirmed rows only
- `flight_number`, `airline_iata`, `airline_name`
- `departure_time`, `arrival_time`, `duration_minutes`, `stops`
- `adults`, `children`, `infants`
- `party_total_gbp` — confirmed party total. The ONLY price used for leaderboard.
- `call_1_price_gbp` — research only, do not use for leaderboard
- `result_bucket` — 'best' | 'other'
- `result_rank` — position within bucket
- `query_type` — 'one_way' | 'round_trip_confirmed'
- `booking_token` — store for audit / future concierge handoff (expires ~30 min)
- `raw_json` — full API response object. Never lose a field.

**Dropped fields (do not re-add):**
- `price_level`, `typical_price_low_gbp`, `typical_price_high_gbp` — dropped. SearchAPI.io's price_insights is carrier-specific, absent for LCCs (easyJet, Ryanair), and requires an extra call. Unreliable for our routes. Replaced by own tracer data over time.
- `price_history` — same reason. Dropped.

**Two collection patterns:**
- **Cross-sectional** (weekly): two-stage pipeline — calendar pre-filter then detail calls. All airports × destinations × promising dates.
- **Tracer set** (daily): small core subset re-queried repeatedly as departure approaches. Builds booking lead-time curve.

---

### Layer 3 — Derived / Serving Data (pre-computed on schedule)

- `destination_window_data` — borough-independent payload per destination × window
- `borough_overlay` — thin borough layer: window dates, inset saving, fine offset, ground transport
- `leaderboard` — ranked destinations per borough × window × duration × family composition
- `narratives` — Sonnet 4.6 generated copy per destination/insight

**Baseline vs Smart (leaderboard yield):**
- Baseline = naive: LHR, Saturday departure, 4 seats together, return
- Smart = optimised: best net-of-transport airport, inset-day departure, open-jaw where applicable, baggage true-cost applied
- Yield = Baseline − Smart

---

## Flight Data Pipeline — Final Architecture

### API Provider: SearchAPI.io

**NOT SerpAPI.** SearchAPI.io confirmed after Phase A validation.

- Base URL: `https://www.searchapi.io/api/v1/search`
- Environment variable: `SEARCHAPI_KEY`
- Flight type parameter: `flight_type=one_way` / `flight_type=round_trip` (NOT `type=2` — that is SerpAPI syntax)
- Always send: `gl=gb`, `hl=en`, `currency=GBP`
- Max flight duration filter: `max_flight_duration=360` (API-level, no post-processing needed)
- No equivalent of SerpAPI's `deep_search=true` on SearchAPI.io — not needed

### Two-Stage Pipeline

**Stage 1 — Calendar call** (`engine=google_flights_calendar`)
- One call per destination group, all 5 London airports, all relevant destination airports
- Parameters: `departure_id=LGW,LHR,STN,LTN,LCY`, `arrival_id=BCN,SVQ,AGP` (example)
- Parameters: `outbound_date_start`, `outbound_date_end` covering window ±2 days
- Parameters: `flight_type=one_way`
- Returns: `calendar` array — `{departure, price, is_lowest_price?}` per date
- No airport attribution in response — just date + cheapest price across the matrix
- Max range: 200 days for one_way (well within our needs)
- Purpose: identify which 5–8 dates are worth running full detail calls against

**Stage 2 — Detail call** (`engine=google_flights`)
- One call per selected date, per direction (outbound + return independently)
- `flight_type=one_way` — single call, price is confirmed, `booking_token` returned directly
- No `departure_token` chain needed for one-way — confirmed in Phase A
- Returns: `best_flights` + `other_flights`, all stored in `fare_snapshots`
- Store ALL results per call (~10 rows), not just cheapest

**Round-trip pass** (Feature 11 only)
- `flight_type=round_trip` — two-call chain still required (Call 1 → departure_token → Call 2)
- Only run for `ROUND_TRIP_ELIGIBLE_CARRIERS = {'BA', 'TP'}` — LCCs price legs independently
- Check cheapest carrier from Stage 2 outbound. If in eligible set, run round-trip call
- Store with `query_type='round_trip_confirmed'`, `party_total_gbp` = full confirmed round-trip total
- Runs as final pass of weekly cross-sectional job, same `run_id`

### Carrier notes
- Ryanair (FR): flies from STN for many routes. Confirmed visible on SearchAPI.io.
- easyJet (U2): confirmed on SearchAPI.io
- Vueling (VY): confirmed
- TAP (TP): confirmed. Round-trip eligible.
- BA: round-trip eligible.
- Ryanair, easyJet, Wizz, Vueling: price legs independently — NOT round-trip eligible

### Call volume estimate (pilot, 3 destinations)
- Stage 1: ~6 calendar calls (3 destinations × 2 directions)
- Stage 2: ~6 calendar calls × 6 promising dates × 1 call = ~36 detail calls
- Round-trip pass: ~10 calls (BA/TP routes only)
- **Total pilot: ~52 calls per weekly run** — dramatic reduction from pre-calendar estimate of ~430

---

## Phase A Findings (Complete)

Tested against SerpAPI then validated against SearchAPI.io docs and Colab tests.

**Q1 — Fare calendar:** SerpAPI has NO calendar (one call per date-pair). SearchAPI.io has `engine=google_flights_calendar` — confirmed working. One-way calendar returns `{departure, price}` per date, no airport attribution. Cheapest date flagged with `is_lowest_price: true`.

**Q2 — Passenger-type breakdown:** Neither SerpAPI nor SearchAPI.io breaks price out by passenger type. `price` / `party_total_gbp` is always a lump sum for the queried party. **The "per-passenger-type storage" principle from original CONTEXT.md is superseded.** Store `party_total_gbp` + composition fields. Per-seat fare = `party_total_gbp ÷ (adults + children)` — defensible for LCCs where child fare = adult fare.

**Q3 — Baggage:** Neither API returns useful baggage data. `airline_baggage_fees` curated table is the sole source for Feature 6. Do not attempt to parse baggage from API responses.

**Q4 — One-way call chain:** SearchAPI.io one-way is a single call. `booking_token` returned directly. No `departure_token` chain. Confirmed in Colab test.

**Q5 — Price insights:** Available only when a specific flight's booking options are opened (Stage 3 effectively). Carrier-specific ranges — different for BA vs Eurowings vs easyJet on the same route. Absent entirely for easyJet in testing. **Dropped from schema and pipeline. Do not re-add.**

**Q6 — Multi-airport on calendar:** Confirmed. `departure_id=LGW,LHR,STN,LTN,LCY` and `arrival_id=BCN,SVQ,AGP` work in one calendar call. Returns global cheapest per date across all combinations.

**Q7 — Round-trip airport constraint:** Confirmed same-airport-both-ways for round trips. Not a problem — round-trip calls are Feature 11 only, where same-airport is correct.

---

## Pilot Plan

**3 destinations to exercise every trip type:**
1. Barcelona (BCN) — city, all 5 London airports
2. Andalusian Corridor (SVQ→AGP) — open-jaw circuit
3. Malta (MLA) — resort, single airport

**Pilot window:** October 2026 half-term only.
**Scale to 21 destinations** once pilot validates pipeline.

---

## File Structure

```
app/
  results/
    flight-insights/
      page.tsx
components/
  flight-insights/
    inset-calendar.tsx
    compliance-calculator.tsx
    all-in-cost.tsx
    capacity-warning.tsx
    hub-routing-optimizer.tsx        ← merged feature (was 5,6,8,11)
    baggage-calculator.tsx
    historical-booking-window.tsx
    rain-probability.tsx
lib/
  flights/
    fetchFlights.ts                  ← SearchAPI.io adapter (needs update from SerpAPI version)
    snapshotJob.ts                   ← weekly cross-sectional job (not yet built)
    fetchAirports.ts
  schools/
    getSchoolWindows.ts
  safety/
    getFCDO.ts
  weather/
    getWeather.ts
types/
  flight.ts                          ← shared types (generated, needs price_insights fields removed)
data-model.md                        ← full schema reference
CONTEXT.md                           ← this file
CLAUDE.md                            ← Claude Code session instructions
```

---

## Key Decisions (Do Not Relitigate)

- **Financial intelligence tool, not a travel agency or blog.**
- **Borough selector is the hook** — single field, landing page, show inset day result immediately.
- **SearchAPI.io is the flight data provider** — not SerpAPI, Duffel, BrightData, or any scraper.
- **Two-stage pipeline** — calendar call first, detail calls only for promising dates.
- **Two one-way calls as standard** — not round-trip queries. Each leg stored as a separate fare_snapshots row.
- **Round-trip calls for Feature 11 only** — and only for ROUND_TRIP_ELIGIBLE_CARRIERS (BA, TP).
- **Fare snapshots are borough-independent** — never put borough_id in fare_snapshots.
- **Append-only observation layer** — never overwrite a fare snapshot. Timestamp everything.
- **Party total, not per-passenger breakdown** — store party_total_gbp + composition. Per-seat fare derived as party_total ÷ seat_count.
- **price_insights dropped permanently** — carrier-specific, absent on LCCs, requires extra call. Never re-add.
- **Baggage from curated table only** — SearchAPI.io returns nothing useful for baggage.
- **All results per call stored** — not just cheapest. ~10 rows per detail call.
- **max_flight_duration=360 at API level** — no post-processing filter needed.
- **All-in cost is itemised, not a single number** — observed vs estimated clearly labelled.
- **Hub-Routing Optimizer is one merged feature** — not four separate components.
- **Historical Booking Window is two-tier** — Tier 1 (industry-cited) at launch; Tier 2 (own tracer data) after 8–10 weeks.
- **Bucket splitter is a separate lightweight job** — not in cross-sectional run v1. Deferred post-pilot.
- **No Volatility Score — ever.**
- **Pre-generation over real-time** — Batch API → Supabase → instant serve.
- **Duffel: Phase 3 only** — potential booking/concierge handoff layer. Not for data collection.
- **Frequency is a config value** — never hardcode snapshot job schedule.
- **Itinerary builder is Year 2.**
- **Community features are Year 2.**
- **Monetisation: undecided** — revisit after first 50 real users.

---

## Tech Stack

- **Frontend:** Next.js 14 (App Router) + shadcn/ui + Tailwind
- **Database:** Supabase (PostgreSQL)
- **Hosting:** Vercel
- **Email:** Resend
- **Flight data:** SearchAPI.io (`google_flights` + `google_flights_calendar` engines)
- **Weather:** Open-Meteo (free, no key, 5-year historical) — deferred
- **Safety:** FCDO API (free) — deferred
- **Design system:** DESIGN.md (Editorial Fintech tokens)

## Model Routing

- **Haiku 4.5** — data extraction, structured parsing, classification
- **Sonnet 4.6** — narrative generation, insight synthesis
- **Opus** — not needed in Phase 1

## Environment Variables Required

- `SEARCHAPI_KEY` — SearchAPI.io API key (add to Vercel + local .env.local)
- `NEXT_PUBLIC_SUPABASE_URL` — already set
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — already set

---

## Deferred — Do Not Build in Phase 1

- Weather / P(Rain) layer
- FCDO safety analysis
- Fine offset calculator (pending fine-amount research)
- Historical Booking Window Tier 2 (own booking curve — needs months of snapshots)
- Leaderboard visual design
- Family composition UI placement on landing page
- Accommodation live data — use curated estimates for now
- Inventory Bucket Splitter job (separate lightweight job, post-pilot)
- Festival matching
- Email nurture engine
- Post-trip feedback loop
- Itinerary builder
- Community features
- Duffel booking handoff (Phase 3)

---

## Current Build Status

- [x] Borough term dates — live in Supabase
- [x] Inset days — live in Supabase
- [x] Schools database — live in Supabase
- [x] Transport cost matrix — live in Supabase
- [x] Layer 1 tables created — airports, destinations, destination_legs, snapshot_runs, airline_baggage_fees, fare_snapshots
- [x] airports table seeded (all London origins + European destinations)
- [x] Phase A validation complete (SerpAPI → SearchAPI.io decision)
- [x] Data model designed (data-model.md)
- [x] types/flight.ts generated (needs price_insights fields removed)
- [x] fetchFlights.ts generated (needs SearchAPI.io update — currently written for SerpAPI)
- [ ] **destinations table seeded** ← TODO
- [ ] **destination_legs table seeded** ← TODO
- [ ] **airline_baggage_fees table populated** ← TODO
- [ ] **SEARCHAPI_KEY added to Vercel** ← TODO
- [ ] **fetchFlights.ts updated for SearchAPI.io** ← CURRENT TASK
- [ ] snapshotJob.ts built (weekly cross-sectional runner)
- [ ] Vercel cron schedule configured
- [ ] 3-destination pilot run (Barcelona, Andalusian Corridor, Malta)
- [ ] Pilot validation (confirm savings levers extractable)
- [ ] Scale to 21 destinations
- [ ] Layer 3 derived data generation
- [ ] Flight Insights page components

## Current Task
*Update `fetchFlights.ts` for SearchAPI.io. Then build `snapshotJob.ts`.*

Key changes needed in fetchFlights.ts:
1. Change base URL to `https://www.searchapi.io/api/v1/search`
2. Change env var from `SERPAPI_KEY` to `SEARCHAPI_KEY`
3. Change `type: 2` to `flight_type: 'one_way'` and `type: 1` to `flight_type: 'round_trip'`
4. Remove `deep_search: true` (not a SearchAPI.io parameter)
5. Add `max_flight_duration: 360` as a standard parameter
6. Remove all price_insights parsing (priceLevel, typicalPriceLowGbp, typicalPriceHighGbp fields)
7. Add `fetchCalendarLegs()` function using `engine=google_flights_calendar`
8. Note: one-way returns `booking_token` directly — no departure_token chain needed
