-- Price history for one exact recommended itinerary (both legs), across every
-- valid past snapshot run. Powers the "How this price has moved" insight card.
--
-- Matching rule: flight_number is NULL for every fare_snapshots row, so legs
-- are matched on origin_iata + destination_iata + departure_date +
-- airline_iata + party composition only (never flight_number).
--
-- Run validity heuristic (deliberately NOT a hardcoded run_id list, so this
-- keeps working unchanged as more runs accumulate):
--   run_type = 'cross_sectional' AND completed_at IS NOT NULL AND success_calls > 0,
--   further excluding any run whose success_calls is less than 10% of the
--   largest success_calls among those candidates (guards against small
--   test/debug/crashed runs without needing manual curation).
-- observed_at is deliberately NOT used to decide run validity — it only
-- labels each chart point with when that specific price was captured.
-- Airport params — deliberately 4 separate ones, not "London airport, same
-- both ways" + "destination airport per leg" as an earlier version assumed.
-- get_smart_recommendation's combinations can use a DIFFERENT London airport
-- for the outbound vs the return leg (Feature 5 — Multi-Airport Search), so
-- collapsing them into one shared "origin" silently matched the wrong leg
-- whenever a combination was asymmetric. p_ret_origin_iata is passed as
-- out_dest_iata by the caller for non-circuit destinations (the RPC's own
-- JSON never exposes the return leg's true abroad departure airport — see
-- route.ts for the caveat on open-jaw circuits).
CREATE OR REPLACE FUNCTION get_price_movement(
  p_out_origin_iata  char(3),  -- London airport, outbound departure
  p_out_dest_iata    char(3),  -- destination-side airport, outbound leg
  p_ret_origin_iata  char(3),  -- destination-side airport, return leg
  p_ret_dest_iata    char(3),  -- London airport, return arrival (may differ from p_out_origin_iata)
  p_outbound_date    date,
  p_return_date      date,
  p_outbound_carrier char(2),
  p_return_carrier   char(2),
  p_adults           smallint,
  p_children         smallint,
  p_infants          smallint
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_result jsonb;
BEGIN

  WITH candidate_runs AS (
    SELECT id, completed_at, success_calls
    FROM snapshot_runs
    WHERE run_type = 'cross_sectional'
      AND completed_at IS NOT NULL
      AND success_calls > 0
  ),
  threshold AS (
    SELECT COALESCE(MAX(success_calls), 0) * 0.10 AS min_calls
    FROM candidate_runs
  ),
  valid_runs AS (
    SELECT cr.id AS run_id
    FROM candidate_runs cr, threshold t
    WHERE cr.success_calls >= t.min_calls
  ),
  -- DISTINCT ON, ordered by price ascending, is the "MIN(party_total_gbp)
  -- grouped by run_id" the duplicate best/other rows require — never a raw
  -- row pull — while also surfacing the observed_at of that cheapest row.
  outbound_per_run AS (
    SELECT DISTINCT ON (run_id)
      run_id, party_total_gbp AS outbound_gbp, observed_at AS outbound_observed_at
    FROM fare_snapshots
    WHERE origin_iata      = p_out_origin_iata
      AND destination_iata = p_out_dest_iata
      AND departure_date   = p_outbound_date
      AND airline_iata      = p_outbound_carrier
      AND adults   = p_adults
      AND children = p_children
      AND infants  = p_infants
      AND run_id IN (SELECT run_id FROM valid_runs)
    ORDER BY run_id, party_total_gbp ASC, observed_at ASC
  ),
  return_per_run AS (
    SELECT DISTINCT ON (run_id)
      run_id, party_total_gbp AS return_gbp, observed_at AS return_observed_at
    FROM fare_snapshots
    WHERE origin_iata      = p_ret_origin_iata
      AND destination_iata = p_ret_dest_iata
      AND departure_date   = p_return_date
      AND airline_iata      = p_return_carrier
      AND adults   = p_adults
      AND children = p_children
      AND infants  = p_infants
      AND run_id IN (SELECT run_id FROM valid_runs)
    ORDER BY run_id, party_total_gbp ASC, observed_at ASC
  ),
  usable AS (
    -- Inner join — a run only counts if BOTH legs have a matching row.
    -- Never interpolate or assume a missing leg's price.
    SELECT
      o.run_id,
      (o.outbound_gbp + r.return_gbp) AS total_gbp,
      LEAST(o.outbound_observed_at, r.return_observed_at) AS checked_on_ts
    FROM outbound_per_run o
    JOIN return_per_run r ON r.run_id = o.run_id
  )

  SELECT jsonb_build_object(
    'checks_total',     (SELECT COUNT(*) FROM valid_runs),
    'checks_with_data', (SELECT COUNT(*) FROM usable),
    'price_points',      COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'checked_on', checked_on_ts::date,
          'total_gbp',  total_gbp
        )
        ORDER BY checked_on_ts ASC
      )
      FROM usable
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;

END;
$$;
