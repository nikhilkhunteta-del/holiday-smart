-- Function: get_multi_airport
-- Purpose:  Compare all 5 London airports on net-of-transfer all-in cost.
--           Returns one row per London airport that has fare data for BOTH
--           directions on the requested dates.
--
-- Transfer data sourced from district_airport_transit (postcode district × airport).
-- If no transit row exists for a district × airport pair, transport fields are null
-- and allin totals are null — the airport still appears but sorts last.
--
-- Duration fields are already in minutes — no conversion needed.
--
-- LHR is flagged is_baseline = true as the comparison reference (naive choice).
-- Best-value airport (lowest allin_public) is flagged is_best_value = true.
-- saving_vs_lhr_public / saving_vs_lhr_uber are positive when the airport beats LHR.

CREATE OR REPLACE FUNCTION get_multi_airport(
  p_destination_slug text,
  p_school_urn       text,
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
  v_postcode_district text;
  v_run_id        uuid;
  v_adults        smallint;
  v_children      smallint;
  v_infants       smallint;
  v_result        jsonb;
BEGIN

  -- ── 1. Destination + airport pool ──────────────────────────────────────────

  SELECT id INTO v_dest_id
    FROM destinations WHERE slug = p_destination_slug;

  IF v_dest_id IS NULL THEN
    RETURN jsonb_build_object('error', 'destination not found: ' || p_destination_slug);
  END IF;

  SELECT array_agg(iata_code) INTO v_dest_airports
    FROM destination_airports
   WHERE destination_id = v_dest_id AND excluded = false;

  IF v_dest_airports IS NULL OR array_length(v_dest_airports, 1) = 0 THEN
    RETURN jsonb_build_object('error', 'no airport pool for: ' || p_destination_slug);
  END IF;

  -- ── 2. School postcode district ─────────────────────────────────────────────

  SELECT postcode_district INTO v_postcode_district FROM all_schools WHERE urn = p_school_urn;

  -- ── 3. Composition matching ─────────────────────────────────────────────────

  SELECT c.adults, c.children, c.infants
    INTO v_adults, v_children, v_infants
    FROM (VALUES
      (1::smallint, 1::smallint, 0::smallint),
      (2::smallint, 1::smallint, 0::smallint),
      (2::smallint, 2::smallint, 0::smallint),
      (2::smallint, 0::smallint, 1::smallint)
    ) AS c(adults, children, infants)
   ORDER BY abs(c.adults   - p_adults)
          + abs(c.children - p_children)
          + abs(c.infants  - p_infants)
   LIMIT 1;

  -- ── 4. Latest completed cross-sectional run ─────────────────────────────────

  SELECT id INTO v_run_id
    FROM snapshot_runs
   WHERE run_type    = 'cross_sectional'
     AND completed_at IS NOT NULL
   ORDER BY completed_at DESC
   LIMIT 1;

  IF v_run_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no completed cross-sectional run found');
  END IF;

  -- ── 5. Airport comparison matrix ────────────────────────────────────────────

  WITH
    -- Best outbound fare per London departure airport
    out_fares AS (
      SELECT
        fs.origin_iata                AS airport_iata,
        MIN(fs.party_total_gbp)       AS out_fare
      FROM fare_snapshots fs
     WHERE fs.run_id           = v_run_id
       AND fs.origin_iata      IN ('LHR','LGW','STN','LTN','LCY')
       AND fs.destination_iata  = ANY(v_dest_airports)
       AND fs.departure_date   = p_outbound_date
       AND fs.adults   = v_adults
       AND fs.children = v_children
       AND fs.infants  = v_infants
     GROUP BY fs.origin_iata
    ),
    -- Best return fare per London arrival airport
    ret_fares AS (
      SELECT
        fs.destination_iata           AS airport_iata,
        MIN(fs.party_total_gbp)       AS ret_fare
      FROM fare_snapshots fs
     WHERE fs.run_id           = v_run_id
       AND fs.origin_iata       = ANY(v_dest_airports)
       AND fs.destination_iata  IN ('LHR','LGW','STN','LTN','LCY')
       AND fs.departure_date   = p_return_date
       AND fs.adults   = v_adults
       AND fs.children = v_children
       AND fs.infants  = v_infants
     GROUP BY fs.destination_iata
    ),
    -- Only airports with fare data in BOTH directions on these dates
    airport_pairs AS (
      SELECT
        o.airport_iata,
        o.out_fare,
        r.ret_fare,
        o.out_fare + r.ret_fare AS total_fare
      FROM out_fares o
      JOIN ret_fares r ON r.airport_iata = o.airport_iata
    ),
    -- Join district transit data; all transport fields null when no row exists
    with_transit AS (
      SELECT
        ap.airport_iata,
        ap.out_fare,
        ap.ret_fare,
        ap.total_fare,
        -- Public transport (null when transit row absent or field unpopulated)
        CASE
          WHEN dat.transit_offpeak_fare_pence IS NOT NULL
          THEN dat.transit_offpeak_fare_pence / 100.0
          ELSE NULL
        END                                        AS public_cost,
        dat.transit_offpeak_route_summary          AS public_method,
        dat.transit_offpeak_duration_mins          AS public_duration_mins,
        -- Uber range
        dat.uber_low_pence  / 100.0                AS uber_low,
        dat.uber_high_pence / 100.0                AS uber_high,
        dat.uber_duration_offpeak_mins             AS drive_duration_mins,
        dat.airport_code IS NOT NULL               AS has_transit_data,
        -- All-in totals: null when transit data absent so these airports sort last,
        -- preventing a misleading "cheapest" label on data-absent rows
        CASE
          WHEN dat.airport_code IS NOT NULL
           AND dat.transit_offpeak_fare_pence IS NOT NULL
          THEN ap.total_fare + dat.transit_offpeak_fare_pence / 100.0
          ELSE NULL
        END                                        AS allin_public,
        CASE
          WHEN dat.uber_low_pence  IS NOT NULL
           AND dat.uber_high_pence IS NOT NULL
          THEN ap.total_fare
               + (dat.uber_low_pence + dat.uber_high_pence) / 2.0 / 100.0
          ELSE NULL
        END                                        AS allin_uber_mid
      FROM airport_pairs ap
      LEFT JOIN district_airport_transit dat
             ON dat.postcode_district = v_postcode_district
            AND dat.airport_code      = ap.airport_iata
    ),
    ranked AS (
      SELECT
        t.*,
        -- Best value: lowest allin_public among airports with transit data
        (t.allin_public IS NOT NULL
         AND t.allin_public = MIN(t.allin_public) OVER ()) AS is_best_value,
        -- LHR is the naive baseline the parent would have booked
        (t.airport_iata = 'LHR')                         AS is_baseline,
        -- Saving vs LHR (positive = cheaper than LHR; null if LHR has no data)
        MAX(CASE WHEN t.airport_iata = 'LHR' THEN t.allin_public  END) OVER ()
          - t.allin_public                               AS saving_vs_lhr_public,
        MAX(CASE WHEN t.airport_iata = 'LHR' THEN t.allin_uber_mid END) OVER ()
          - t.allin_uber_mid                             AS saving_vs_lhr_uber
      FROM with_transit t
    )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'airport_iata',          r.airport_iata,
        'outbound_fare',         r.out_fare,
        'return_fare',           r.ret_fare,
        'total_fare',            r.total_fare,
        'has_transit_data',      r.has_transit_data,
        'public_cost',           r.public_cost,
        'public_method',         r.public_method,
        'public_duration_mins',  r.public_duration_mins,
        'uber_low',              r.uber_low,
        'uber_high',             r.uber_high,
        'uber_mid',              CASE
                                   WHEN r.uber_low IS NOT NULL
                                    AND r.uber_high IS NOT NULL
                                   THEN ROUND(((r.uber_low + r.uber_high) / 2)::numeric, 2)
                                   ELSE NULL
                                 END,
        'drive_duration_mins',   r.drive_duration_mins,
        'allin_public',          ROUND(r.allin_public::numeric, 2),
        'allin_uber_mid',        ROUND(r.allin_uber_mid::numeric, 2),
        'saving_vs_lhr_public',  ROUND(r.saving_vs_lhr_public::numeric, 2),
        'saving_vs_lhr_uber',    ROUND(r.saving_vs_lhr_uber::numeric, 2),
        'is_best_value',         r.is_best_value,
        'is_baseline',           r.is_baseline
      )
      ORDER BY r.allin_public ASC NULLS LAST
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM ranked r;

  RETURN jsonb_build_object(
    'outbound_date', p_outbound_date,
    'return_date',   p_return_date,
    'airports',      v_result
  );

END;
$$;
