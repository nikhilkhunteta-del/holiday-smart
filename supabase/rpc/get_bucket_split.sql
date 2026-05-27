-- Function: get_bucket_split
-- Purpose:  Checks whether booking as two smaller groups saves money vs one booking.
--           Only meaningful for 2A+2C and 2A+1C. Returns NULL for all other inputs.
--
-- 2A+2C (is_estimated = false):
--   Both compositions (2A+2C and 1A+1C) are directly collected in every snapshot
--   run, so the comparison uses observed prices throughout.
--   split_price = 2 × best(1A+1C round trip)
--
-- 2A+1C (is_estimated = true):
--   1A+1C is observed; solo 1A is not collected.
--   Solo adult is estimated as together / 3 — defensible because LCCs price
--   child fares equal to adult fares, making per-seat cost uniform.
--   split_price = best(1A+1C round trip) + (together / 3)
--
-- p_origin_iata: specific London airport to query (caller selects after get_multi_airport).
-- above_threshold: saving >= £30 (same threshold as all other saving levers).

CREATE OR REPLACE FUNCTION get_bucket_split(
  p_destination_slug text,
  p_origin_iata      char(3),
  p_outbound_date    date,
  p_return_date      date,
  p_adults           smallint,
  p_children         smallint,
  p_infants          smallint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_dest_id       uuid;
  v_dest_airports text[];
  v_run_id        uuid;

  v_composition   text;
  v_is_estimated  boolean;

  -- Outbound + return fares for the "together" booking
  v_tog_out       numeric;
  v_tog_ret       numeric;
  v_together      numeric;

  -- 1A+1C fares (used in both branches)
  v_split_out     numeric;
  v_split_ret     numeric;
  v_split_1a1c    numeric;   -- round-trip total for 1A+1C

  -- 2A+1C only: solo-adult estimate
  v_solo_adult    numeric;

  v_split         numeric;
  v_saving        numeric;
BEGIN

  -- ── 1. Guard: only meaningful for 2A+2C and 2A+1C ──────────────────────────

  IF (p_adults = 2 AND p_children = 2 AND p_infants = 0) THEN
    v_composition  := '2A+2C';
    v_is_estimated := false;
  ELSIF (p_adults = 2 AND p_children = 1 AND p_infants = 0) THEN
    v_composition  := '2A+1C';
    v_is_estimated := true;
  ELSE
    RETURN NULL;
  END IF;

  -- ── 2. Destination airport pool ─────────────────────────────────────────────

  SELECT id INTO v_dest_id FROM destinations WHERE slug = p_destination_slug;

  IF v_dest_id IS NULL THEN
    RETURN jsonb_build_object('error', 'destination not found: ' || p_destination_slug);
  END IF;

  SELECT array_agg(iata_code) INTO v_dest_airports
    FROM destination_airports
   WHERE destination_id = v_dest_id AND excluded = false;

  IF v_dest_airports IS NULL OR array_length(v_dest_airports, 1) = 0 THEN
    RETURN jsonb_build_object('error', 'no airport pool for: ' || p_destination_slug);
  END IF;

  -- ── 3. Latest completed cross-sectional run ─────────────────────────────────

  SELECT id INTO v_run_id
    FROM snapshot_runs
   WHERE run_type    = 'cross_sectional'
     AND completed_at IS NOT NULL
   ORDER BY completed_at DESC
   LIMIT 1;

  IF v_run_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no completed cross-sectional run found');
  END IF;

  -- ── 4a. "Together" fare — the queried composition ───────────────────────────

  SELECT MIN(party_total_gbp) INTO v_tog_out
    FROM fare_snapshots
   WHERE run_id           = v_run_id
     AND origin_iata      = p_origin_iata
     AND destination_iata  = ANY(v_dest_airports)
     AND departure_date   = p_outbound_date
     AND adults   = p_adults
     AND children = p_children
     AND infants  = 0;

  SELECT MIN(party_total_gbp) INTO v_tog_ret
    FROM fare_snapshots
   WHERE run_id           = v_run_id
     AND origin_iata       = ANY(v_dest_airports)
     AND destination_iata  = p_origin_iata
     AND departure_date   = p_return_date
     AND adults   = p_adults
     AND children = p_children
     AND infants  = 0;

  IF v_tog_out IS NULL OR v_tog_ret IS NULL THEN
    RETURN jsonb_build_object(
      'composition',  v_composition,
      'is_estimated', v_is_estimated,
      'error',        'no fare data for ' || v_composition || ' on requested dates'
    );
  END IF;

  v_together := v_tog_out + v_tog_ret;

  -- ── 4b. 1A+1C fare (direct observation, used by both branches) ──────────────

  SELECT MIN(party_total_gbp) INTO v_split_out
    FROM fare_snapshots
   WHERE run_id           = v_run_id
     AND origin_iata      = p_origin_iata
     AND destination_iata  = ANY(v_dest_airports)
     AND departure_date   = p_outbound_date
     AND adults = 1 AND children = 1 AND infants = 0;

  SELECT MIN(party_total_gbp) INTO v_split_ret
    FROM fare_snapshots
   WHERE run_id           = v_run_id
     AND origin_iata       = ANY(v_dest_airports)
     AND destination_iata  = p_origin_iata
     AND departure_date   = p_return_date
     AND adults = 1 AND children = 1 AND infants = 0;

  IF v_split_out IS NULL OR v_split_ret IS NULL THEN
    -- 1A+1C data absent — can't compute split price for either composition
    RETURN jsonb_build_object(
      'composition',    v_composition,
      'together_price', ROUND(v_together, 2),
      'split_price',    NULL,
      'saving',         NULL,
      'above_threshold', NULL,
      'is_estimated',   v_is_estimated,
      'recommended',    'together',
      'note',           'no 1A+1C fare data available for split comparison'
    );
  END IF;

  v_split_1a1c := v_split_out + v_split_ret;

  -- ── 5. Branch: 2A+2C (both sides directly observed) ─────────────────────────

  IF v_composition = '2A+2C' THEN
    -- split_price = 2 × 1A+1C round trip (two separate group bookings)
    v_split  := 2 * v_split_1a1c;
    v_saving := v_together - v_split;

    RETURN jsonb_build_object(
      'composition',     v_composition,
      'together_price',  ROUND(v_together,  2),
      'split_price',     ROUND(v_split,     2),
      'saving',          ROUND(v_saving,    2),
      'above_threshold', v_saving >= 30,
      'is_estimated',    false,
      'recommended',     CASE WHEN v_saving > 0 THEN 'split' ELSE 'together' END
    );
  END IF;

  -- ── 6. Branch: 2A+1C (solo adult is estimated) ───────────────────────────────
  --
  -- 1A+1C is directly observed above.
  -- Solo adult (1A+0C) is not collected in snapshot runs.
  -- Estimate: together / 3 — LCCs price child = adult, so each of 3 seats
  -- costs the same. This is the cheapest defensible estimate; actual 1A fare
  -- may differ on carriers with age-differentiated pricing (BA, TP).

  v_solo_adult := v_together / 3.0;
  v_split      := v_split_1a1c + v_solo_adult;
  v_saving     := v_together - v_split;

  RETURN jsonb_build_object(
    'composition',         v_composition,
    'together_price',      ROUND(v_together,    2),
    'one_a_one_c_price',   ROUND(v_split_1a1c,  2),
    'solo_adult_estimate', ROUND(v_solo_adult,  2),
    'split_price',         ROUND(v_split,       2),
    'saving',              ROUND(v_saving,      2),
    'above_threshold',     v_saving >= 30,
    'is_estimated',        true,
    'recommended',         CASE WHEN v_saving > 0 THEN 'split' ELSE 'together' END
  );

END;
$$;
