CREATE OR REPLACE FUNCTION get_leg_options(
  p_destination_slug  text,
  p_school_urn        text,
  p_date              date,
  p_direction         text,
  p_adults            smallint,
  p_children          smallint,
  p_infants           smallint,
  p_cabin_bags        smallint,
  p_checked_bags      smallint,
  p_seats_together    boolean
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_postcode_district text;
  v_run_id            uuid;
  v_destination_id    uuid;
  v_composition       record;
  v_result            jsonb;
BEGIN

  SELECT postcode_district INTO v_postcode_district
  FROM all_schools WHERE urn = p_school_urn;

  SELECT id INTO v_run_id
  FROM snapshot_runs
  WHERE run_type = 'cross_sectional'
    AND completed_at IS NOT NULL
  ORDER BY completed_at DESC
  LIMIT 1;

  SELECT id INTO v_destination_id
  FROM destinations WHERE slug = p_destination_slug;

  SELECT adults, children, infants
  INTO v_composition
  FROM (
    VALUES
      (1::smallint, 1::smallint, 0::smallint),
      (2::smallint, 1::smallint, 0::smallint),
      (2::smallint, 2::smallint, 0::smallint),
      (2::smallint, 0::smallint, 1::smallint)
  ) AS compositions(adults, children, infants)
  ORDER BY
    ABS(adults - p_adults) +
    ABS(children - p_children) +
    ABS(infants - p_infants)
  LIMIT 1;

  WITH all_options AS (
    SELECT
      fs.airline_iata,
      ab.airline_name,
      fs.origin_iata,
      fs.destination_iata,
      fs.departure_time,
      fs.arrival_time,
      fs.duration_minutes,
      fs.stops,
      fs.party_total_gbp AS fare_gbp,
      CASE
        WHEN p_cabin_bags = 0 THEN 0
        WHEN COALESCE(ab.cabin_bag_included, false) THEN 0
        ELSE ab.full_cabin_bag_fee_gbp * p_cabin_bags
      END AS cabin_bag_cost_gbp,
      CASE
        WHEN p_checked_bags = 0 THEN 0
        ELSE COALESCE(ab.first_checked_bag_gbp, 0) * p_checked_bags
      END AS checked_bag_cost_gbp,
      -- Ryanair only: flat £10 one-time fee for 2+ adults wanting seats together.
      CASE
        WHEN fs.airline_iata = 'FR' AND p_adults >= 2 AND p_seats_together THEN 10.00
        ELSE 0.00
      END AS seat_cost_gbp,
      ab.family_seating_notes AS seating_notes,
      dat.transit_offpeak_fare_pence,
      dat.transit_peak_fare_pence,
      dat.uber_low_pence,
      dat.uber_high_pence,
      dat.transit_offpeak_route_summary AS transit_method,
      dat.transit_offpeak_duration_mins AS transit_duration_mins,
      dat.transit_changes,
      dat.uber_duration_offpeak_mins,
      -- Destination transfer: one-way share (half round-trip) so outbound +
      -- return leg totals sum to the correct round-trip amount without
      -- double-counting.  Taxi-vs-transit logic mirrors get_smart_recommendation.
      CASE
        WHEN da.transit_cost_gbp IS NULL
          THEN COALESCE(da.taxi_cost_gbp, 0)
        WHEN da.transit_changes >= 2
          AND (da.taxi_cost_gbp - da.transit_cost_gbp * (p_adults + p_children)) <= 50
          THEN COALESCE(da.taxi_cost_gbp, 0)
        ELSE COALESCE(da.transit_cost_gbp * (p_adults + p_children), 0)
      END AS destination_transfer_gbp,
      da.transit_cost_gbp   AS dest_transit_cost_gbp,
      da.taxi_cost_gbp      AS dest_taxi_cost_gbp,
      da.transit_changes    AS dest_transit_changes,
      fs.airline_iata IN ('FR', 'W6') AS baggage_is_estimate,
      fs.airline_iata = 'FR' AND p_adults >= 2 AND NOT p_seats_together AS family_split_risk
    FROM fare_snapshots fs
    JOIN airline_baggage_fees ab ON ab.airline_iata = fs.airline_iata
    LEFT JOIN district_airport_transit dat
      ON dat.postcode_district = v_postcode_district
      AND dat.airport_code = CASE
        WHEN p_direction = 'outbound' THEN fs.origin_iata
        ELSE fs.destination_iata
      END
    JOIN destination_airports da
      ON da.destination_id = v_destination_id
      AND da.iata_code = CASE
        WHEN p_direction = 'outbound' THEN fs.destination_iata
        ELSE fs.origin_iata
      END
      AND (da.excluded IS NULL OR da.excluded = false)
    WHERE fs.run_id = v_run_id
      AND fs.stops = 0
      AND fs.adults = v_composition.adults
      AND fs.children = v_composition.children
      AND fs.infants = v_composition.infants
      AND fs.departure_date = p_date
      AND CASE
        WHEN p_direction = 'outbound' THEN
          fs.origin_iata IN ('LHR','LGW','STN','LTN','LCY')
        ELSE
          fs.destination_iata IN ('LHR','LGW','STN','LTN','LCY')
      END
  ),
  cheapest_per_route AS (
    -- Sorted/deduped on flight-only cost — family-adjusted transit cost isn't
    -- known until the TS layer computes it, which re-sorts by true total anyway.
    SELECT DISTINCT ON (airline_iata, origin_iata, destination_iata)
      *,
      (fare_gbp + cabin_bag_cost_gbp + checked_bag_cost_gbp +
       seat_cost_gbp + destination_transfer_gbp) AS sort_total
    FROM all_options
    ORDER BY
      airline_iata,
      origin_iata,
      destination_iata,
      (fare_gbp + cabin_bag_cost_gbp + checked_bag_cost_gbp +
       seat_cost_gbp + destination_transfer_gbp) ASC
  )

  SELECT jsonb_agg(
    jsonb_build_object(
      'airline_iata',               airline_iata,
      'airline_name',               airline_name,
      'origin_iata',                origin_iata,
      'destination_iata',           destination_iata,
      'departure_time',             departure_time,
      'arrival_time',               arrival_time,
      'duration_minutes',           duration_minutes,
      'stops',                      stops,
      'fare_gbp',                   fare_gbp,
      'cabin_bag_cost_gbp',         cabin_bag_cost_gbp,
      'checked_bag_cost_gbp',       checked_bag_cost_gbp,
      'seat_cost_gbp',              seat_cost_gbp,
      'ancillary_gbp',
        cabin_bag_cost_gbp + checked_bag_cost_gbp + seat_cost_gbp,
      'transit_offpeak_fare_pence', transit_offpeak_fare_pence,
      'transit_peak_fare_pence',    transit_peak_fare_pence,
      'uber_low_pence',             uber_low_pence,
      'uber_high_pence',            uber_high_pence,
      'uber_duration_offpeak_mins', uber_duration_offpeak_mins,
      'transit_method',             transit_method,
      'transit_duration_mins',      transit_duration_mins,
      'transit_changes',            transit_changes,
      'destination_transfer_gbp',   destination_transfer_gbp,
      'dest_transit_cost_gbp',      dest_transit_cost_gbp,
      'dest_taxi_cost_gbp',         dest_taxi_cost_gbp,
      'dest_transit_changes',       dest_transit_changes,
      'baggage_is_estimate',        baggage_is_estimate,
      'family_split_risk',          family_split_risk,
      'seating_notes',              seating_notes
    )
    ORDER BY sort_total ASC
  )
  INTO v_result
  FROM cheapest_per_route;

  RETURN jsonb_build_object(
    'date',      p_date,
    'direction', p_direction,
    'options',   COALESCE(v_result, '[]'::jsonb)
  );

END;
$$;
