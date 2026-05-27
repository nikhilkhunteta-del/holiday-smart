-- Function: get_compliance_scenarios
-- Purpose:  Departure × return date matrix for the Compliance Calculator component.
--           Each row = one departure/return combination with flight fare, fine, and
--           net saving. Inset days appear as explicitly labelled rows.
--
-- Window resolution:
--   No date parameters are passed in; the relevant break window is inferred from the
--   date range of fare snapshots for this destination in the latest run. This anchors
--   the term-date lookup without depending on CURRENT_DATE.
--
-- Term-date fallback:
--   Mirrors pages/api/term-dates.js + pages/api/borough-dates.js:
--   school_term_dates first, then borough_term_dates.
--
-- Inset-day fallback:
--   school_inset_days for this URN first. If none found within the departure
--   candidate range, falls back to distinct inset days from other schools in the
--   same borough (borough proxy).
--
-- Fine logic:
--   £80 per parent per child per absence period (not per day). One period = one
--   continuous stretch of missed school, either on the departure or return side.
--   Maximum two absence periods per trip (one on each side). fine_is_estimate = true.
--   Fine uses the caller's actual p_adults / p_children, not the matched composition.
--
-- Composition matching (for fare lookups only):
--   Input mapped to nearest of (1A+1C, 2A+1C, 2A+2C, 2A+1inf). Never errors.

CREATE OR REPLACE FUNCTION get_compliance_scenarios(
  p_destination_slug text,
  p_school_urn       text,
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
  v_borough       text;
  v_run_id        uuid;
  v_adults        smallint;
  v_children      smallint;
  v_infants       smallint;
  v_data_min      date;
  v_data_max      date;
  v_window_start  date;
  v_window_end    date;
  v_window_source text := 'school';
  v_baseline      numeric;
  v_scenarios     jsonb;
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

  -- ── 2. School borough (drives term-date and inset-day fallbacks) ────────────

  SELECT borough INTO v_borough FROM all_schools WHERE urn = p_school_urn;

  -- ── 3. Composition matching (fare lookups only) ─────────────────────────────

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

  -- ── 5. Anchor to fare data date range ───────────────────────────────────────
  -- Use the spread of departure_dates in the latest run to identify which school
  -- break the data covers, without depending on CURRENT_DATE.

  SELECT MIN(departure_date), MAX(departure_date)
    INTO v_data_min, v_data_max
    FROM fare_snapshots
   WHERE run_id           = v_run_id
     AND destination_iata  = ANY(v_dest_airports)
     AND origin_iata       IN ('LHR','LGW','STN','LTN','LCY');

  IF v_data_min IS NULL THEN
    RETURN jsonb_build_object('error', 'no fare data for destination in latest run');
  END IF;

  -- ── 6. Official window — two-tier fallback (school → borough) ──────────────
  -- Same pattern as pages/api/term-dates.js + pages/api/borough-dates.js.
  -- Pick the term whose start_date sits nearest the mid-point of the data range.

  SELECT start_date, end_date
    INTO v_window_start, v_window_end
    FROM school_term_dates
   WHERE urn        = p_school_urn
     AND start_date BETWEEN v_data_min - 7 AND v_data_max + 7
   ORDER BY abs(start_date - (v_data_min + (v_data_max - v_data_min) / 2)) ASC
   LIMIT 1;

  IF v_window_start IS NULL THEN
    v_window_source := 'borough';
    IF v_borough IS NOT NULL THEN
      SELECT start_date, end_date
        INTO v_window_start, v_window_end
        FROM borough_term_dates
       WHERE borough    = v_borough
         AND start_date BETWEEN v_data_min - 7 AND v_data_max + 7
       ORDER BY abs(start_date - (v_data_min + (v_data_max - v_data_min) / 2)) ASC
       LIMIT 1;
    END IF;
  END IF;

  IF v_window_start IS NULL OR v_window_end IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'could not resolve term window for school: ' || p_school_urn
    );
  END IF;

  -- ── 7. Baseline price ───────────────────────────────────────────────────────

  SELECT party_total_gbp INTO v_baseline
    FROM baseline_snapshots
   WHERE destination_slug = p_destination_slug
     AND adults  = v_adults
     AND children = v_children
     AND infants  = v_infants
   LIMIT 1;

  -- ── 8. Build scenario matrix ────────────────────────────────────────────────

  WITH
    -- School-specific inset days within the departure candidate range
    school_inset AS (
      SELECT date AS d
        FROM school_inset_days
       WHERE urn  = p_school_urn
         AND date BETWEEN v_window_start - 3 AND v_window_end + 3
    ),
    -- Borough-proxy fallback: distinct inset days from other schools in the same
    -- borough, used only when this school genuinely has no inset days at all
    borough_inset AS (
      SELECT DISTINCT sid.date AS d
        FROM school_inset_days sid
        JOIN all_schools sch ON sch.urn = sid.urn AND sch.borough = v_borough
       WHERE sid.date BETWEEN v_window_start - 3 AND v_window_end + 3
         AND NOT EXISTS (SELECT 1 FROM school_inset_days WHERE urn = p_school_urn)
    ),
    -- Effective inset days: school-first, borough fallback
    inset_days AS (
      SELECT d FROM school_inset
      UNION
      SELECT d FROM borough_inset
    ),
    -- Departure candidates: official_start −3 to +1, plus inset days in that range
    depart_cands AS (
      SELECT (v_window_start - 3 + s.n)::date AS dep_date
        FROM generate_series(0, 4) AS s(n)        -- offsets −3, −2, −1, 0, +1
      UNION
      SELECT d AS dep_date
        FROM inset_days
       WHERE d BETWEEN v_window_start - 3 AND v_window_start + 1
    ),
    -- Return candidates: official_end −1 to +3
    return_cands AS (
      SELECT (v_window_end - 1 + s.n)::date AS ret_date
        FROM generate_series(0, 4) AS s(n)        -- offsets −1, 0, +1, +2, +3
    ),
    -- Cross-product, filtered to valid trip lengths
    combos AS (
      SELECT dep.dep_date, ret.ret_date
        FROM depart_cands dep
        CROSS JOIN return_cands ret
       WHERE ret.ret_date > dep.dep_date
         AND (ret.ret_date - dep.dep_date) BETWEEN 3 AND 11
    ),
    -- Best fare per combination (correlated subqueries are fast at this cardinality)
    fares AS (
      SELECT
        c.dep_date,
        c.ret_date,
        (SELECT MIN(fs.party_total_gbp)
           FROM fare_snapshots fs
          WHERE fs.run_id           = v_run_id
            AND fs.origin_iata      IN ('LHR','LGW','STN','LTN','LCY')
            AND fs.destination_iata  = ANY(v_dest_airports)
            AND fs.departure_date   = c.dep_date
            AND fs.adults   = v_adults
            AND fs.children = v_children
            AND fs.infants  = v_infants
        ) AS out_fare,
        (SELECT MIN(fs.party_total_gbp)
           FROM fare_snapshots fs
          WHERE fs.run_id           = v_run_id
            AND fs.origin_iata       = ANY(v_dest_airports)
            AND fs.destination_iata  IN ('LHR','LGW','STN','LTN','LCY')
            AND fs.departure_date   = c.ret_date
            AND fs.adults   = v_adults
            AND fs.children = v_children
            AND fs.infants  = v_infants
        ) AS ret_fare
      FROM combos c
    ),
    -- Absence + inset classification; skip combos with no fare data
    calcs AS (
      SELECT
        f.dep_date,
        f.ret_date,
        f.out_fare,
        f.ret_fare,
        f.out_fare + f.ret_fare AS total_fare,
        -- Departure-side absence: calendar days before official start, minus inset days
        -- (inset days are non-teaching days and do not count as unauthorised absence)
        GREATEST(0,
          (v_window_start - f.dep_date)
          - (SELECT COUNT(*)::int FROM inset_days id
              WHERE id.d >= f.dep_date AND id.d < v_window_start)
        ) AS dep_absence,
        -- Return-side absence: calendar days after break ends, minus any inset days
        GREATEST(0,
          (f.ret_date - v_window_end)
          - (SELECT COUNT(*)::int FROM inset_days id
              WHERE id.d > v_window_end AND id.d <= f.ret_date)
        ) AS ret_absence,
        EXISTS(SELECT 1 FROM inset_days id WHERE id.d = f.dep_date) AS uses_inset_day
      FROM fares f
      WHERE f.out_fare IS NOT NULL
        AND f.ret_fare IS NOT NULL
    ),
    -- Fine calculation and savings
    with_fine AS (
      SELECT
        c.*,
        c.dep_absence + c.ret_absence AS total_absence_days,
        (c.dep_absence > 0 OR c.ret_absence > 0) AS requires_absence,
        -- Fine: £80 per parent per child per absence period (not per day).
        -- Uses caller's actual adults/children, not the matched fare-lookup composition.
        -- Maximum 2 periods (one departure-side + one return-side).
        80 * p_adults * p_children
          * (CASE WHEN c.dep_absence > 0 THEN 1 ELSE 0 END
           + CASE WHEN c.ret_absence > 0 THEN 1 ELSE 0 END) AS fine_gbp,
        ROUND(v_baseline - c.total_fare, 2) AS gross_saving,
        ROUND(
          v_baseline - c.total_fare
          - 80 * p_adults * p_children
            * (CASE WHEN c.dep_absence > 0 THEN 1 ELSE 0 END
             + CASE WHEN c.ret_absence > 0 THEN 1 ELSE 0 END),
          2
        ) AS net_saving
      FROM calcs c
    ),
    -- Mark the single best row (highest net saving)
    ranked AS (
      SELECT
        w.*,
        (w.net_saving IS NOT NULL
         AND w.net_saving = MAX(w.net_saving) OVER ()) AS is_recommended
      FROM with_fine w
    )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'label',
          CASE
            WHEN r.uses_inset_day THEN
              to_char(r.dep_date, 'Dy DD Mon')
              || ' (inset day) → '
              || to_char(r.ret_date, 'Dy DD Mon')
            WHEN r.total_absence_days > 0 THEN
              to_char(r.dep_date, 'Dy DD Mon')
              || ' → ' || to_char(r.ret_date, 'Dy DD Mon')
              || ' (' || r.total_absence_days || ' absence day'
              || CASE WHEN r.total_absence_days > 1 THEN 's' ELSE '' END || ')'
            ELSE
              to_char(r.dep_date, 'Dy DD Mon')
              || ' → '
              || to_char(r.ret_date, 'Dy DD Mon')
          END,
        'departure_date',             r.dep_date,
        'return_date',                r.ret_date,
        'trip_days',                  r.ret_date - r.dep_date,
        'outbound_fare',              r.out_fare,
        'return_fare',                r.ret_fare,
        'total_fare',                 r.total_fare,
        'departure_absence_days',     r.dep_absence,
        'return_absence_days',        r.ret_absence,
        'total_absence_days',         r.total_absence_days,
        'fine_gbp',                   r.fine_gbp,
        'fine_is_estimate',           true,
        'gross_saving',               r.gross_saving,
        'net_saving_vs_baseline',     r.net_saving,
        'requires_term_time_absence', r.requires_absence,
        'uses_inset_day',             r.uses_inset_day,
        'is_recommended',             r.is_recommended
      )
      ORDER BY r.net_saving DESC NULLS LAST
    ),
    '[]'::jsonb
  )
  INTO v_scenarios
  FROM ranked r;

  RETURN jsonb_build_object(
    'window_start',   v_window_start,
    'window_end',     v_window_end,
    'window_source',  v_window_source,
    'baseline_price', v_baseline,
    'scenarios',      v_scenarios
  );

END;
$$;
