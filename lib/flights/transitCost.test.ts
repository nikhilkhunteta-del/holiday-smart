// Transit cost unit tests — pure logic only (no Supabase connection needed).
// computeTransitCost is a pure function; each test constructs row data directly.
//
// Run: npx tsx lib/flights/transitCost.test.ts  (requires npm install first)

import assert from 'assert';
import { computeTransitCost, isTflPeak } from './transitCost';
import type { TransitCostInput, TransitRow } from './transitCost';

// ── Minimal test runner ───────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err}`);
    failed++;
  }
}

// ── isTflPeak ─────────────────────────────────────────────────────────────────

console.log('\nisTflPeak');

test('07:30 Thursday is peak (06:30–09:30 morning band)', () => {
  assert.equal(isTflPeak(new Date('2026-10-22T07:30:00')), true);
});

test('09:00 Thursday is still peak (edge of 09:30 cutoff)', () => {
  assert.equal(isTflPeak(new Date('2026-10-22T09:00:00')), true);
});

test('10:00 Thursday is off-peak (outside both bands)', () => {
  assert.equal(isTflPeak(new Date('2026-10-22T10:00:00')), false);
});

test('Saturday is never peak', () => {
  assert.equal(isTflPeak(new Date('2026-10-24T08:00:00')), false);
});

// ── computeTransitCost ────────────────────────────────────────────────────────

console.log('\ncomputeTransitCost');

// ── Case 1 ────────────────────────────────────────────────────────────────────
// SE18 → LGW, 07:30 Thursday (peak), 2A + 2C (ages 8, 10)
// Thameslink → NR child fare: 50% of adult fare regardless of peak time
// total_family = 2×1800 + 900 + 900 = 5400p
// total_people = 4 → XL: uber low=round(7000×1.5)=10500, high=round(9500×1.5)=14250, mean=12375
// 07:30 → hourOfDep = 7, NOT < EARLY_FLIGHT_HOUR (7) → Rule 1 does not apply
// 0 changes < MIN_CHANGES_FOR_UBER → Rule 3 does not apply
// → Rule 4: transit recommended, cost = 5400p
test('case 1: SE18 → LGW, 07:30, 2A+2C (ages 8,10) — transit recommended', () => {
  const input: TransitCostInput = {
    postcode_district: 'SE18',
    airport_iata: 'LGW',
    departure_time: new Date('2026-10-22T07:30:00'),
    adults: 2,
    children: [{ age: 8 }, { age: 10 }],
    infants: 0,
  };

  const row: TransitRow = {
    transit_offpeak_fare_pence: 1800,
    transit_offpeak_duration_mins: 65,
    transit_offpeak_route_summary: 'Thameslink to Gatwick Airport',
    transit_changes: 0,
    uber_low_pence: 7000,
    uber_high_pence: 9500,
    uber_duration_offpeak_mins: 45,
  };

  const r = computeTransitCost(input, row);

  assert.equal(r.recommended_mode, 'transit');
  assert.equal(r.recommended_cost_pence, 5400);
  assert.equal(r.transit?.total_family_pence, 5400);
  assert.equal(r.transit?.changes, 0);
  assert.equal(r.transit?.fare_unavailable, false);
  assert.equal(r.transit?.early_flight_warning, false);
  assert.equal(r.uber.is_xl, true);
  assert.equal(r.uber.low_pence, 10500);
  assert.equal(r.uber.high_pence, 14250);
  assert.equal(r.uber.mean_pence, 12375);
  assert.equal(r.uber.early_morning_surge_warning, false);
});

// ── Case 2 ────────────────────────────────────────────────────────────────────
// N10 → STN, 06:30 departure, 2A + 1C (age 6)
// hourOfDep = 6 < EARLY_FLIGHT_HOUR (7) → Rule 1: uber recommended, cost = uber_high
// total_people = 3 < UBER_XL_THRESHOLD → no XL
// early_morning_surge_warning: hourOfDep = 6, NOT < EARLY_SURGE_HOUR (6) → false
test('case 2: N10 → STN, 06:30, 2A+1C (age 6) — uber (early flight, Rule 1)', () => {
  const input: TransitCostInput = {
    postcode_district: 'N10',
    airport_iata: 'STN',
    departure_time: new Date('2026-10-22T06:30:00'),
    adults: 2,
    children: [{ age: 6 }],
    infants: 0,
  };

  const row: TransitRow = {
    transit_offpeak_fare_pence: 1200,
    transit_offpeak_duration_mins: 75,
    transit_offpeak_route_summary: 'Tube to Liverpool Street, Stansted Express',
    transit_changes: 1,
    uber_low_pence: 5000,
    uber_high_pence: 7500,
    uber_duration_offpeak_mins: 60,
  };

  const r = computeTransitCost(input, row);

  assert.equal(r.recommended_mode, 'uber');
  assert.equal(r.recommended_cost_pence, 7500);   // uber_high, not XL-adjusted
  assert.equal(r.transit?.early_flight_warning, true);
  assert.equal(r.uber.is_xl, false);
  assert.equal(r.uber.low_pence, 5000);
  assert.equal(r.uber.high_pence, 7500);
  assert.equal(r.uber.mean_pence, 6250);
  assert.equal(r.uber.early_morning_surge_warning, false);  // 06:30, NOT < 06:00
});

// ── Case 3 ────────────────────────────────────────────────────────────────────
// RM18 → LHR, 09:00 Thursday (peak — 540 mins in 390–570 band), 2A + 2C (ages 5, 8)
// TfL route → TfL peak child fare: 105p each (both ages in 5–15 band)
// total_family = 2×1500 + 105 + 105 = 3210p
// total_people = 4 → XL: uber low=round(3500×1.5)=5250, high=round(6000×1.5)=9000, mean=7125
// Rule 3: transit_changes=4 >= MIN_CHANGES_FOR_UBER (2)
//         AND uber_mean−transit_total = 7125−3210 = 3915 ≤ UBER_TRANSIT_THRESHOLD (5000)
// → uber recommended, cost = uber_mean = 7125p
test('case 3: RM18 → LHR, 09:00, 2A+2C (ages 5,8) — uber (4 changes, Rule 3)', () => {
  const input: TransitCostInput = {
    postcode_district: 'RM18',
    airport_iata: 'LHR',
    departure_time: new Date('2026-10-22T09:00:00'),
    adults: 2,
    children: [{ age: 5 }, { age: 8 }],
    infants: 0,
  };

  const row: TransitRow = {
    transit_offpeak_fare_pence: 1500,
    transit_offpeak_duration_mins: 120,
    transit_offpeak_route_summary: 'Tube to Elizabeth line',
    transit_changes: 4,
    uber_low_pence: 3500,
    uber_high_pence: 6000,
    uber_duration_offpeak_mins: 75,
  };

  const r = computeTransitCost(input, row);

  assert.equal(r.recommended_mode, 'uber');
  assert.equal(r.recommended_cost_pence, 7125);
  assert.equal(r.transit?.changes, 4);
  assert.equal(r.transit?.total_family_pence, 3210);
  assert.equal(r.transit?.early_flight_warning, false);
  assert.equal(r.uber.is_xl, true);
  assert.equal(r.uber.low_pence, 5250);
  assert.equal(r.uber.high_pence, 9000);
  assert.equal(r.uber.mean_pence, 7125);
  assert.equal(r.uber.early_morning_surge_warning, false);
});

// ── Case 4 ────────────────────────────────────────────────────────────────────
// TW6 → LHR, 10:00, 2A (no children)
// TW6 (Feltham) is walking distance from LHR → transit_offpeak_fare_pence = 0 (not null)
// total_family = 2×0 = 0p
// total_people = 2 < UBER_XL_THRESHOLD → no XL
// fare = 0 is not null → fare_unavailable = false → Rule 2 does not apply
// 0 changes → Rule 3 does not apply
// → Rule 4: transit recommended, cost = 0p
// time_delta = uber(10) − transit(15) = −5 min, |−5| < 30 → show_time_delta = false
test('case 4: TW6 → LHR, 10:00, 2A — transit, £0 (walking distance)', () => {
  const input: TransitCostInput = {
    postcode_district: 'TW6',
    airport_iata: 'LHR',
    departure_time: new Date('2026-10-22T10:00:00'),
    adults: 2,
    children: [],
    infants: 0,
  };

  const row: TransitRow = {
    transit_offpeak_fare_pence: 0,
    transit_offpeak_duration_mins: 15,
    transit_offpeak_route_summary: 'Walking / shuttle from TW6',
    transit_changes: 0,
    uber_low_pence: 600,
    uber_high_pence: 1200,
    uber_duration_offpeak_mins: 10,
  };

  const r = computeTransitCost(input, row);

  assert.equal(r.recommended_mode, 'transit');
  assert.equal(r.recommended_cost_pence, 0);
  assert.equal(r.transit?.total_family_pence, 0);
  assert.equal(r.transit?.fare_unavailable, false);
  assert.equal(r.transit?.early_flight_warning, false);
  assert.equal(r.uber.is_xl, false);
  assert.equal(r.uber.early_morning_surge_warning, false);
  assert.equal(r.time_delta_mins, -5);
  assert.equal(r.show_time_delta, false);
});

// ── Edge: no row found ────────────────────────────────────────────────────────
test('no transit row → transit is null, uber recommended (Rule 2)', () => {
  const input: TransitCostInput = {
    postcode_district: 'XX99',
    airport_iata: 'LGW',
    departure_time: new Date('2026-10-22T10:00:00'),
    adults: 2,
    children: [],
    infants: 0,
  };

  const r = computeTransitCost(input, null);

  assert.equal(r.transit, null);
  assert.equal(r.recommended_mode, 'uber');
  assert.equal(r.recommended_cost_pence, 0);  // no uber data → 0
});

// ── Edge: transit fare NULL (row exists but fare absent) ──────────────────────
test('null fare in row → fare_unavailable, uber recommended (Rule 2)', () => {
  const input: TransitCostInput = {
    postcode_district: 'SE1',
    airport_iata: 'LTN',
    departure_time: new Date('2026-10-22T11:00:00'),
    adults: 2,
    children: [],
    infants: 0,
  };

  const row: TransitRow = {
    transit_offpeak_fare_pence: null,
    transit_offpeak_duration_mins: 90,
    transit_offpeak_route_summary: 'National Express coach',
    transit_changes: 0,
    uber_low_pence: 8000,
    uber_high_pence: 12000,
    uber_duration_offpeak_mins: 70,
  };

  const r = computeTransitCost(input, row);

  assert.equal(r.transit?.fare_unavailable, true);
  assert.equal(r.transit?.confidence, 'estimated');
  assert.equal(r.recommended_mode, 'uber');
  assert.equal(r.recommended_cost_pence, 10000);  // (8000+12000)/2
});

// ── Edge: early morning surge (before 06:00) ──────────────────────────────────
test('05:45 departure sets early_morning_surge_warning', () => {
  const input: TransitCostInput = {
    postcode_district: 'SE18',
    airport_iata: 'LGW',
    departure_time: new Date('2026-10-22T05:45:00'),
    adults: 2,
    children: [],
    infants: 0,
  };

  const row: TransitRow = {
    transit_offpeak_fare_pence: 1800,
    transit_offpeak_duration_mins: 65,
    transit_offpeak_route_summary: 'Thameslink to Gatwick Airport',
    transit_changes: 0,
    uber_low_pence: 7000,
    uber_high_pence: 9500,
    uber_duration_offpeak_mins: 45,
  };

  const r = computeTransitCost(input, row);

  assert.equal(r.recommended_mode, 'uber');        // Rule 1: hourOfDep=5 < 7
  assert.equal(r.uber.early_morning_surge_warning, true);  // hourOfDep=5 < 6
  assert.equal(r.transit?.early_flight_warning, true);
});

// ── Result ────────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
