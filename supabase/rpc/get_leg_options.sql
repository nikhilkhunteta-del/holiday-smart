
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

  -- Match composition — nearest of 1A+1C, 2A+1C, 2A+2C, 2A+1inf
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

  -- CTE to compute all costs, then pick cheapest 
  -- per airline × origin × destination combination
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
      fs.party_total_gbp                          AS fare_gbp,

      -- Cabin bag cost
      CASE
        WHEN p_cabin_bags = 0 THEN 0
        WHEN ab.cabin_bag_included = true THEN 0
        ELSE ab.full_cabin_bag_fee_gbp * p_cabin_bags
      END                                         AS cabin_bag_cost_gbp,

      -- Checked bag cost
      CASE
        WHEN p_checked_bags = 0 THEN 0
        ELSE COALESCE(ab.first_checked_bag_gbp, 0) * p_checked_bags
      END                                         AS checked_bag_cost_gbp,

      -- Seat cost
      CASE
        WHEN NOT p_seats_together THEN 0
        WHEN ab.seat_selection_gbp IS NULL THEN 0
        ELSE ab.seat_selection_gbp *
          CASE WHEN ab.child_same_as_adult
            THEN p_adults + p_children
            ELSE p_adults
          END
      END                                         AS seat_cost_gbp,

      -- Transit cost (pence → pounds)
      ROUND(dat.transit_offpeak_fare_pence / 100.0, 2)
                                                  AS transit_cost_gbp,
      dat.transit_offpeak_route_summary           AS transit_method,
      dat.transit_offpeak_duration_mins           AS transit_duration_mins,
      dat.transit_changes,
      ROUND((dat.uber_low_pence + dat.uber_high_pence) 
            / 200.0, 2)                           AS uber_cost_gbp,

      -- Destination transfer (× 2 for both ways)
      COALESCE(da.transfer_cost_gbp, 0) * 2       AS destination_transfer_gbp,

      fs.airline_iata IN ('FR', 'W6')             AS baggage_is_estimate,
      ab.seat_selection_gbp IS NOT NULL 
        AND NOT p_seats_together                  AS family_split_risk

    FROM fare_snapshots fs
    JOIN airline_baggage_fees ab
      ON ab.airline_iata = fs.airline_iata
    -- Transit: match on the London airport
    LEFT JOIN district_airport_transit dat
      ON dat.postcode_district = v_postcode_district
      AND dat.airport_code = CASE
        WHEN p_direction = 'outbound' THEN fs.origin_iata
        ELSE fs.destination_iata
      END
    -- Destination airports: filter to this destination only
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
  -- Pick cheapest flight per airline × origin × destination
  -- (eliminates multiple flights same route same day)
  cheapest_per_route AS (
    SELECT DISTINCT ON (airline_iata, origin_iata, destination_iata)
      *,
      (fare_gbp
       + CASE WHEN p_cabin_bags = 0 THEN 0
              WHEN cabin_bag_cost_gbp IS NULL THEN 0
              ELSE cabin_bag_cost_gbp END
       + CASE WHEN p_checked_bags = 0 THEN 0
              WHEN checked_bag_cost_gbp IS NULL THEN 0
              ELSE checked_bag_cost_gbp END
       + seat_cost_gbp
       + COALESCE(transit_cost_gbp, 0)
       + destination_transfer_gbp
      )                                           AS total_gbp
    FROM all_options
    ORDER BY 
      airline_iata, 
      origin_iata, 
      destination_iata,
      (fare_gbp + seat_cost_gbp 
       + COALESCE(transit_cost_gbp, 0) 
       + destination_transfer_gbp) ASC
  )

  SELECT jsonb_agg(
    jsonb_build_object(
      'airline_iata',         fs.airline_iata,
      'airline_name',         ab.airline_name,
      'origin_iata',          fs.origin_iata,
      'destination_iata',     fs.destination_iata,
      'departure_time',       fs.departure_time,
      'arrival_time',         fs.arrival_time,
      'duration_minutes',     fs.duration_minutes,
      'stops',                fs.stops,
      'fare_gbp',             fs.party_total_gbp,
      'cabin_bag_cost_gbp',
        CASE
          WHEN p_cabin_bags = 0 THEN 0
          WHEN COALESCE(ab.cabin_bag_included, false) THEN 0
          ELSE LEAST(
            ab.full_cabin_bag_fee_gbp * p_cabin_bags,
            COALESCE(
              ab.bundle_price_delta_gbp *
                (CASE WHEN ab.child_same_as_adult
                 THEN p_adults + p_children
                 ELSE p_adults END),
              999999
            )
          )
        END,
      'checked_bag_cost_gbp',
        CASE
          WHEN p_checked_bags = 0 THEN 0
          ELSE COALESCE(ab.first_checked_bag_gbp, 0) * p_checked_bags
        END,
      'seat_cost_gbp',
        CASE
          WHEN NOT p_seats_together THEN 0
          WHEN ab.seat_selection_gbp IS NULL THEN 0
          ELSE ab.seat_selection_gbp *
            (CASE WHEN ab.child_same_as_adult
             THEN p_adults + p_children
             ELSE p_adults END)
        END,
      -- Raw pence values for TypeScript transit computation
      'transit_offpeak_fare_pence', dat.transit_offpeak_fare_pence,
      'transit_peak_fare_pence',    dat.transit_peak_fare_pence,
      'uber_low_pence',             dat.uber_low_pence,
      'uber_high_pence',            dat.uber_high_pence,
      -- transit_cost_gbp intentionally NULL — TypeScript computes it
      'transit_cost_gbp',           NULL,
      'transit_method',             dat.transit_offpeak_route_summary,
      'transit_duration_mins',      dat.transit_offpeak_duration_mins,
      'transit_changes',            dat.transit_changes,
      'destination_transfer_gbp',
        COALESCE(da.transfer_cost_gbp, 0) * 2,
      'baggage_is_estimate',
        (fs.airline_iata IN ('FR', 'W6')),
      'family_split_risk',
        (ab.seat_selection_gbp IS NOT NULL AND NOT p_seats_together)
    )
    -- Sort by fare + ancillary + dest transfer only.
    -- TypeScript adds transit and re-sorts by true all-in total.
    ORDER BY
      (fs.party_total_gbp
       + COALESCE(
           CASE
             WHEN p_cabin_bags = 0 THEN 0
             WHEN COALESCE(ab.cabin_bag_included, false) THEN 0
             ELSE LEAST(
               ab.full_cabin_bag_fee_gbp * p_cabin_bags,
               COALESCE(ab.bundle_price_delta_gbp *
                 (CASE WHEN ab.child_same_as_adult
                  THEN p_adults + p_children
                  ELSE p_adults END), 999999)
             )
           END, 0)
       + COALESCE(
           CASE
             WHEN p_checked_bags = 0 THEN 0
             ELSE COALESCE(ab.first_checked_bag_gbp, 0) * p_checked_bags
           END, 0)
       + COALESCE(da.transfer_cost_gbp * 2, 0)
      ) ASC
  )
  INTO v_result
  FROM cheapest_per_route;

  RETURN jsonb_build_object(
    'date',      p_date,
    'direction', p_direction,
    'options',   COALESCE(v_result, '[]'::jsonb)
  );

END;
