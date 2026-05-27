-- Seed: airline_baggage_fees
--
-- !! APPROXIMATE VALUES — REQUIRE MANUAL VERIFICATION BEFORE PRODUCTION USE !!
-- Sources: airline websites, Which? / The Points Guy fee tracking, public reporting.
-- Figures reflect mid-2025 à la carte pricing on short-haul routes.
-- All values are returned as baggage_is_estimate = true in the UI.
-- Re-verify at least annually and before major price-change periods (Jan, Sep).
--
-- Covered carriers: FR (Ryanair), U2 (easyJet), W6 (Wizz), VY (Vueling),
--                   TP (TAP Air Portugal), BA (British Airways)
--
-- bundle_price_delta_gbp: per person per flight (one-way leg), NOT round-trip.
-- first_checked_bag_gbp:  à la carte add-on to the cheapest fare tier, per person per leg.
-- seat_selection_gbp:     typical mid-cabin economy seat; not window/exit premium.

INSERT INTO airline_baggage_fees (
  airline_iata,
  airline_name,
  cabin_bag_included,
  cabin_bag_max_kg,
  cabin_bag_size_cm,
  first_checked_bag_gbp,
  second_checked_bag_gbp,
  seat_selection_gbp,
  bundle_name,
  bundle_price_delta_gbp,
  bundle_includes_checked,
  notes
) VALUES

  -- ── Ryanair (FR) ─────────────────────────────────────────────────────────────
  -- Cabin: 40×20×25 personal item free; 55×40×20 requires Priority add-on.
  -- Checked bag price fluctuates significantly with booking lead time and route.
  ( 'FR', 'Ryanair',
    true,  10.0, '40x20x25',
    29.00, 38.00,
    5.00,
    'Priority + 2 Carry-On Bags', 10.00, false,
    'ESTIMATE. Checked bag add-on ranges £20–45 depending on route and lead time; '
    '£29 is a mid-range advance booking figure. Seat selection at £5 is a basic '
    'non-priority, non-exit seat average. Priority bundle adds overhead carry-on '
    'but NOT a checked bag — bundle_includes_checked = false is intentional.'
  ),

  -- ── easyJet (U2) ─────────────────────────────────────────────────────────────
  -- Cabin: 45×36×20 underseat bag always free (Hands Free). Overhead requires
  -- upgrade to Standard fare or Hands Free add-on (~£7–12/person/flight).
  -- Standard fare includes 23 kg checked bag — bundle models this tier upgrade.
  ( 'U2', 'easyJet',
    true,  15.0, '45x36x20',
    22.00, 30.00,
    8.00,
    'easyJet Standard', 25.00, true,
    'ESTIMATE. £22 is à la carte checked bag add-on to a Hand Baggage Only fare. '
    'Standard fare (bundle) includes 23 kg checked bag; delta ≈ £25/person/leg. '
    'Seat selection at £8 is mid-cabin average; front/exit seats are higher.'
  ),

  -- ── Wizz Air (W6) ────────────────────────────────────────────────────────────
  -- Cabin: 40×30×20 underseat bag free. 55×40×23 carry-on needs WIZZ Go or add-on.
  -- WIZZ Go bundle includes carry-on + 1 checked bag + seat selection.
  ( 'W6', 'Wizz Air',
    true,  10.0, '40x30x20',
    26.00, 32.00,
    5.00,
    'WIZZ Go', 22.00, true,
    'ESTIMATE. Wizz uses heavy dynamic pricing; £26 is a typical advance-purchase '
    'checked bag cost. WIZZ Go bundle price varies; £22/person/leg is a mid-range '
    'estimate. Verify current figures at wizzair.com.'
  ),

  -- ── Vueling (VY) ─────────────────────────────────────────────────────────────
  -- Cabin: overhead carry-on (55×40×20, up to 10 kg) included in all fares.
  -- Optima fare includes 1 checked bag + seat selection + fast-track.
  ( 'VY', 'Vueling',
    true,  10.0, '55x40x20',
    20.00, 28.00,
    6.00,
    'Optima', 22.00, true,
    'ESTIMATE. Carry-on included in all Vueling fares. £20 is à la carte checked '
    'bag on Basic/Ahorro fares. Optima delta of £22/person/leg is approximate; '
    'actual varies by route. Verify at vueling.com.'
  ),

  -- ── TAP Air Portugal (TP) ────────────────────────────────────────────────────
  -- Cabin: 55×40×20 up to 10 kg included. Discount fare is hand-baggage-only on
  -- short-haul. Classic includes 1×23 kg checked bag.
  ( 'TP', 'TAP Air Portugal',
    true,  10.0, '55x40x20',
    28.00, 42.00,
    10.00,
    'TAP Classic', 32.00, true,
    'ESTIMATE. £28 is à la carte checked bag on Discount (hand-baggage-only) fare. '
    'Classic fare (bundle) includes 23 kg; delta ≈ £32/person/leg short-haul. '
    'TAP round trips use same airline both ways — baggage pricing may be more '
    'favourable when booked as a return. Verify at flytap.com.'
  ),

  -- ── British Airways (BA) ─────────────────────────────────────────────────────
  -- Cabin: two bags allowed (overhead + underseat). Short-haul Economy = Hand
  -- Baggage Only by default. Standard (with bag) = next tier up.
  -- Seat selection is free on many fare types but not all.
  ( 'BA', 'British Airways',
    true,  23.0, '56x45x25',
    28.00, 40.00,
    15.00,
    'BA Standard (23 kg checked)', 22.00, true,
    'ESTIMATE. £28 is à la carte checked bag on Hand Baggage Only short-haul fare. '
    'BA Standard includes 23 kg; delta ≈ £22/person/leg. Seat selection at £15 '
    'is a mid-cabin average — many BA fare types include free seat selection. '
    'Round-trip eligible carrier (BA); baggage costs when booked as return may '
    'differ. Verify at britishairways.com.'
  )

ON CONFLICT (airline_iata) DO UPDATE SET
  airline_name            = EXCLUDED.airline_name,
  cabin_bag_included      = EXCLUDED.cabin_bag_included,
  cabin_bag_max_kg        = EXCLUDED.cabin_bag_max_kg,
  cabin_bag_size_cm       = EXCLUDED.cabin_bag_size_cm,
  first_checked_bag_gbp   = EXCLUDED.first_checked_bag_gbp,
  second_checked_bag_gbp  = EXCLUDED.second_checked_bag_gbp,
  seat_selection_gbp      = EXCLUDED.seat_selection_gbp,
  bundle_name             = EXCLUDED.bundle_name,
  bundle_price_delta_gbp  = EXCLUDED.bundle_price_delta_gbp,
  bundle_includes_checked = EXCLUDED.bundle_includes_checked,
  notes                   = EXCLUDED.notes,
  updated_at              = now();
