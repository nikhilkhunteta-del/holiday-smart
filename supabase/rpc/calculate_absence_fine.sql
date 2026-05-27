-- Function: calculate_absence_fine
-- Purpose:  Shared helper for absence and fine calculation.
--           Called by get_savings_breakdown and get_compliance_scenarios so
--           the fine logic is identical across both functions.
--
-- Absence counting:
--   Weekdays (Mon–Fri) only. Weekends are never school days.
--   Inset days excluded from the count — they are non-teaching days and do
--   not count as unauthorised absence.
--   Departure absence: weekdays in [p_dep_date, p_window_start − 1].
--   Return absence:    weekdays in [p_window_end + 1, p_ret_date].
--
-- Fine formula:
--   £80 × p_adults × p_children × number_of_absence_periods.
--   One period = any non-zero stretch on departure or return side (max 2 total).
--   fine_is_estimate = true always — these are statutory maximum amounts.
--   Fine is 0 when p_children = 0 (no school-age children to fine for).

CREATE OR REPLACE FUNCTION calculate_absence_fine(
  p_dep_date     date,
  p_ret_date     date,
  p_window_start date,
  p_window_end   date,
  p_school_urn   text,
  p_adults       smallint,
  p_children     smallint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_dep_absence  smallint := 0;
  v_ret_absence  smallint := 0;
  v_fine         numeric  := 0;
BEGIN
  -- Departure-side absence: weekdays before window_start, excluding inset days
  SELECT COUNT(*)::smallint
    INTO v_dep_absence
    FROM generate_series(p_dep_date, p_window_start - 1, '1 day'::interval) AS d(day)
   WHERE EXTRACT(DOW FROM d.day) BETWEEN 1 AND 5  -- Monday=1 to Friday=5, excludes weekends
     AND NOT EXISTS (
       SELECT 1 FROM school_inset_days
        WHERE urn  = p_school_urn
          AND date = d.day::date
     );

  -- Return-side absence: weekdays after window_end, excluding inset days
  SELECT COUNT(*)::smallint
    INTO v_ret_absence
    FROM generate_series(p_window_end + 1, p_ret_date, '1 day'::interval) AS d(day)
   WHERE EXTRACT(DOW FROM d.day) BETWEEN 1 AND 5
     AND NOT EXISTS (
       SELECT 1 FROM school_inset_days
        WHERE urn  = p_school_urn
          AND date = d.day::date
     );

  -- Fine: £80 per parent per child per absence period (not per day)
  -- One period = one continuous stretch of missed school on either side
  v_fine := 80 * p_adults * p_children
    * (CASE WHEN v_dep_absence > 0 THEN 1 ELSE 0 END
     + CASE WHEN v_ret_absence > 0 THEN 1 ELSE 0 END);

  RETURN jsonb_build_object(
    'departure_absence_days', v_dep_absence,
    'return_absence_days',    v_ret_absence,
    'total_absence_days',     v_dep_absence + v_ret_absence,
    'fine_gbp',               v_fine,
    'fine_is_estimate',       true,
    'requires_absence',       (v_dep_absence > 0 OR v_ret_absence > 0)
  );
END;
$$;
