# Holiday Smart — Data Model
*Layer 1 (Reference) + Layer 2 (Observations)*
*Reflects Phase A findings. Supersedes earlier CONTEXT.md principles where noted.*

---

## Decisions Cemented by Phase A

| Old principle | Superseded by |
|---|---|
| Per-passenger-type price storage | Store `party_total_gbp` + composition fields. Per-seat fare derived at query time (`party_total ÷ (adults + children)`). SerpAPI returns party totals only. |
| Round-trip query chain (Call 1 → departure_token → Call 2) | Two one-way queries (`type=2`). Each leg is one SerpAPI call, one fare_snapshots row. Round-trip total assembled in Layer 3. |
| Store cheapest result only | Store all results returned per call (~10 rows per call). Required for booking-curve, bucket-splitter, and carrier distribution analysis. |

---

## Layer 1 — Reference Tables

### `airports`
All airports the snapshot job will ever query — both London origins and European destinations.

```sql
CREATE TABLE airports (
  iata_code   char(3) PRIMARY KEY,
  name        text NOT NULL,
  city        text NOT NULL,
  country_code char(2) NOT NULL,
  role        text NOT NULL,         -- 'origin' | 'destination' | 'both'
  latitude    numeric(8,5),
  longitude   numeric(8,5),

  CONSTRAINT valid_role CHECK (role IN ('origin', 'destination', 'both'))
);
```

Seed data — London origins:
`LGW, LHR, STN, LTN, LCY`

Seed data — European destinations (from CONTEXT.md destination list):
`BCN, SVQ, AGP, FAO, PSA, FLR, BRI, BDS, NCE, CHQ, HER, SPU, DBV, OPO,
FCO, CIA, LIS, AMS, CPH, MUC, VIE, VCE, TSF, LPA, MLA`

---

### `destinations`
The 21 named destinations. Borough-independent. Classification affects how legs are assembled in Layer 3.

```sql
CREATE TYPE destination_type AS ENUM ('city', 'circuit', 'resort');

CREATE TABLE destinations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text UNIQUE NOT NULL,   -- e.g. 'barcelona', 'andalusian-corridor'
  name         text NOT NULL,          -- e.g. 'Andalusian Corridor, Spain'
  type         destination_type NOT NULL,
  best_windows text[] NOT NULL,        -- e.g. ARRAY['may', 'october']
  active       boolean NOT NULL DEFAULT true
);
```

---

### `destination_legs`
Defines which airport pairs belong to each destination, and in what order.
A city has one leg pair (outbound + return same airports).
A circuit has one or more leg pairs with potentially different airports.

```sql
CREATE TABLE destination_legs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id      uuid NOT NULL REFERENCES destinations(id),
  leg_number          smallint NOT NULL DEFAULT 1,  -- ordering within a circuit

  -- Outbound direction for this leg
  outbound_origin_iata      char(3) NOT NULL REFERENCES airports(iata_code),
  outbound_destination_iata char(3) NOT NULL REFERENCES airports(iata_code),

  -- Return direction (may differ from outbound for open-jaw)
  return_origin_iata        char(3) NOT NULL REFERENCES airports(iata_code),
  return_destination_iata   char(3) NOT NULL REFERENCES airports(iata_code),

  notes text,

  UNIQUE (destination_id, leg_number)
);
```

Example rows:

| destination | leg | outbound | return |
|---|---|---|---|
| Barcelona (city) | 1 | LGW→BCN | BCN→LGW |
| Andalusian Corridor (circuit) | 1 | LGW→SVQ | AGP→LGW |
| Croatia (circuit) | 1 | LGW→SPU | DBV→LGW |
| Crete (circuit) | 1 | LGW→CHQ | HER→LGW |

For all-5-London-airports coverage, the snapshot job iterates over London origin airports
(LGW/LHR/STN/LTN/LCY) × destination_legs. The `destination_legs` table records the
European endpoint only; London endpoint is injected by the job.

---

### `snapshot_runs`
Metadata for each collection run. Allows the booking-curve to know which runs
produced complete data, and supports debugging of partial/failed runs.

```sql
CREATE TABLE snapshot_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type      text NOT NULL,       -- 'cross_sectional' | 'tracer'
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  total_calls   integer,
  success_calls integer,
  failed_calls  integer,
  target_windows text[],            -- e.g. ARRAY['2026-10']
  notes         text,

  CONSTRAINT valid_run_type CHECK (run_type IN ('cross_sectional', 'tracer'))
);
```

---

### `airline_baggage_fees`
Curated per-airline baggage fee table. Primary source for Feature 6 (Baggage True-Cost).
SerpAPI contributes nothing here — this is hand-maintained.

```sql
CREATE TABLE airline_baggage_fees (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  airline_iata              char(2) NOT NULL,
  airline_name              text NOT NULL,

  -- Cabin bag
  cabin_bag_included        boolean NOT NULL,    -- free personal item included?
  cabin_bag_max_kg          numeric(4,1),
  cabin_bag_size_cm         text,               -- e.g. '55x40x20'

  -- Checked baggage à la carte (per bag, per flight, in GBP)
  first_checked_bag_gbp     numeric(6,2),
  second_checked_bag_gbp    numeric(6,2),

  -- Seat selection (per person per flight, economy)
  seat_selection_gbp        numeric(6,2),

  -- Bundle: next fare tier up that includes bags
  -- e.g. easyJet: Flexi includes checked bag
  bundle_name               text,               -- e.g. 'FLEXI', 'PLUS'
  bundle_price_delta_gbp    numeric(6,2),        -- premium over base fare, per person
  bundle_includes_checked   boolean,

  updated_at                timestamptz NOT NULL DEFAULT now(),
  notes                     text,

  UNIQUE (airline_iata)
);
```

Carriers to seed: `FR` (Ryanair), `U2` (easyJet), `W6` (Wizz), `VY` (Vueling),
`TP` (TAP), `BA` (British Airways)

---

## Layer 2 — Observations

### `fare_snapshots`
Core observation table. Append-only. Never overwrite. One row = one flight option
returned by SerpAPI for one leg (one-way query).

A round-trip total is assembled in Layer 3 by summing:
- best outbound snapshot (LGW→BCN, outbound date)
- best return snapshot (BCN→LGW, return date)

from the same `run_id` or nearest contemporaneous run.

```sql
CREATE TABLE fare_snapshots (

  -- Identity
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid NOT NULL REFERENCES snapshot_runs(id),
  snapshot_type text NOT NULL,    -- 'cross_sectional' | 'tracer'

  -- When observed (non-negotiable — powers the booking-curve)
  observed_at   timestamptz NOT NULL DEFAULT now(),

  -- Route (borough-blind — borough never goes here)
  origin_iata      char(3) NOT NULL REFERENCES airports(iata_code),
  destination_iata char(3) NOT NULL REFERENCES airports(iata_code),
  departure_date   date NOT NULL,

  -- Flight identity
  flight_number    text NOT NULL,    -- e.g. 'VY 7827'
  airline_iata     char(2) NOT NULL, -- e.g. 'VY'
  departure_time   time NOT NULL,
  arrival_time     time NOT NULL,
  duration_minutes smallint NOT NULL,
  stops            smallint NOT NULL DEFAULT 0,
  aircraft_type    text,
  is_overnight     boolean NOT NULL DEFAULT false,

  -- Party queried
  adults    smallint NOT NULL,
  children  smallint NOT NULL DEFAULT 0,
  infants   smallint NOT NULL DEFAULT 0,

  -- Price — confirmed one-way leg total for the queried party
  -- DO NOT use call_1_price_gbp for leaderboard. Use party_total_gbp only.
  party_total_gbp       numeric(10,2) NOT NULL,  -- from confirmed call
  call_1_price_gbp      numeric(10,2),            -- stored for research only — biased low for round-trips

  -- Result position within the SearchAPI.io response
  result_bucket  text NOT NULL,    -- 'best' | 'other'
  result_rank    smallint NOT NULL, -- 1 = first result in that bucket

  -- Booking reference (expires ~30 min — store for audit + future concierge handoff)
  booking_token  text,

  -- Full raw preservation — never lose a field you didn't think to parse today
  raw_json  jsonb NOT NULL,

  -- Constraints
  CONSTRAINT valid_snapshot_type CHECK (snapshot_type IN ('cross_sectional', 'tracer')),
  CONSTRAINT positive_price      CHECK (party_total_gbp > 0),
  CONSTRAINT valid_result_bucket CHECK (result_bucket IN ('best', 'other'))

);
```

---

### Indexes

```sql
-- Primary query: cheapest leg for a route on a date
CREATE INDEX idx_fs_route_date
  ON fare_snapshots (origin_iata, destination_iata, departure_date, party_total_gbp ASC);

-- Booking-curve: price history for a specific route × departure date over time
CREATE INDEX idx_fs_booking_curve
  ON fare_snapshots (origin_iata, destination_iata, departure_date, observed_at DESC);

-- Tracer set queries
CREATE INDEX idx_fs_tracer
  ON fare_snapshots (snapshot_type, origin_iata, destination_iata, departure_date, observed_at DESC)
  WHERE snapshot_type = 'tracer';

-- Run grouping (debugging, completeness checks)
CREATE INDEX idx_fs_run
  ON fare_snapshots (run_id, observed_at);

-- Carrier distribution (for Feature 4 — capacity warning, carrier analysis)
CREATE INDEX idx_fs_airline
  ON fare_snapshots (airline_iata, origin_iata, destination_iata, departure_date);
```

---

## Key Design Principles (Binding)

**Borough never enters fare_snapshots.** Flights from London cost the same regardless
of borough. Borough affects only window dates, inset-day saving, fine amount, and
ground transport — all handled in the Layer 3 derived tables.

**Append-only.** Never UPDATE or DELETE a fare_snapshots row. If a run fails
mid-way, mark the `snapshot_runs` row as failed. The data rows stay.

**raw_json is mandatory.** If SerpAPI adds a field tomorrow that you didn't parse
today, you can back-fill from raw_json without re-querying.

**party_total_gbp is the only price used for the leaderboard.** call_1_price_gbp
is stored for research into booking-curve shape only. Phase A confirmed Call 1
round-trip prices are materially lower than bookable prices.

**Round-trip total is assembled in Layer 3, not stored here.** The leaderboard
entry for "Barcelona, 8 nights, 2A+2C, LGW" is computed as:
`MIN(outbound party_total_gbp) + MIN(return party_total_gbp)` from the same run,
where outbound `departure_date` + 8 = return `departure_date`.

---

## Row Volume Estimate (Pilot)

Pilot: 3 destinations × October 2026 half-term only.

| Variable | Value |
|---|---|
| London origin airports | 5 (LGW/LHR/STN/LTN/LCY) |
| Outbound date candidates | ~13 (window ±2 days) |
| Return date candidates per outbound | ~5 avg (3–4 night + 7–10 night slices) |
| Date-pairs per origin-airport | ~40 |
| SerpAPI calls per date-pair | 2 (outbound one-way + return one-way) |
| Results stored per call | ~10 |
| **Total rows — Barcelona alone** | 5 × 40 × 2 × 10 = **4,000 rows** |
| **Total rows — 3 pilot destinations** | ~12,000 rows per weekly cross-sectional run |

At scale (21 destinations, all windows): ~100,000 rows per weekly run.
Supabase free tier handles this comfortably. SerpAPI call count is the cost lever,
not storage.

---

## What Layer 3 Derives From This

*(Design deferred — build after pilot validates Layer 2 pipeline)*

- `destination_window_data` — cheapest routing per destination × window × origin airport
- `borough_overlay` — applies window dates + inset saving + ground transport to Layer 2 prices
- `leaderboard` — baseline vs smart yield per borough × window × duration × composition
- `narratives` — Sonnet 4.6 generated copy, keyed to destination × insight

---

## Open Items Before Building fetchFlights.ts

1. **Confirm `price_insights` appears on one-way (`type=2`) calls.** We only confirmed it
   on round-trip Call 1. If it's absent on one-way queries, `price_level` and
   `typical_price_range` fields may stay null for all rows — which is acceptable but
   should be known before schema is finalised.

2. **Bucket splitter query design.** Feature 5 (Inventory Bucket Splitter) requires
   comparing 2A+2C together vs 2A+2C as two separate 2-passenger queries. This means
   the snapshot job needs to run some routes at multiple compositions. Decide whether
   this goes in the cross-sectional run or a separate lightweight job.

3. **Tracer set definition.** Which specific routes get the daily tracer treatment?
   Recommend: top 5 leaderboard destinations × LGW only × canonical departure dates.
   Keeps tracer cost low while still building the booking curve.
