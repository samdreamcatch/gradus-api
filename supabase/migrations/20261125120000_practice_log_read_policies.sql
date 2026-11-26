-- Practice-log reads: the same rows for the same people, without nested checks.
--
-- Every SELECT on plan_sessions (and, through it, plan_session_move_ratings)
-- ran policies whose subqueries read plans, athletes, coach_profiles and
-- parent_profiles as the caller. Those tables have policies of their own, whose
-- subqueries have more, so planning and running one practice-log read expanded
-- into about 170 subplans. Measured 2026-11-24 on a replay of these migrations
-- with production-sized invented data: 41 ms for one plan's log, against 0.1 ms
-- for the same read with no policies. On the phone log of that evening these
-- reads took 4 to 25 s while the coach widget asked for one per active plan,
-- and everything else on the database waited.
--
-- The four rules are the same four rules in one policy: the caller's own athlete
-- rows, the children they are the primary parent of, the calling coach's own
-- plans, and linked coaches (`shares_athlete_window`, unchanged). The first three
-- are now "the id is in a set that belongs to the caller". The sets come from
-- SECURITY DEFINER functions, so no other table's policies run, and each set is
-- read once for each use of the table in a query, not per row.
-- A function only ever answers about auth.uid(): it takes no arguments.
--
-- Why the rules allow no more than before: each old subquery could only see rows
-- its caller may read, but the rows it looked for (the coach's own plans, the
-- athlete's own row, the parent's own children) are ones those tables' policies
-- already show that caller.
--
-- What changes for later: a new limit on who may read plans, athletes,
-- coach_profiles or parent_profiles no longer reaches the practice log by itself.
-- Add it to these functions too.
--
-- Before applying, compare production with this repo (no limit may exist there
-- that only the old policies carried):
--   SELECT tablename, policyname, permissive, roles, cmd, qual FROM pg_policies
--    WHERE schemaname = 'public' AND tablename IN ('plan_sessions',
--      'plan_session_move_ratings', 'plans', 'athletes', 'coach_profiles', 'parent_profiles');
--
-- INSERT and DELETE policies are untouched. Safe to apply twice; run it as one
-- transaction, at a quiet time (it locks plan_sessions for a moment).

-- 1. Plans owned by the calling coach.
CREATE OR REPLACE FUNCTION public.my_coach_plan_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.id
  FROM public.plans p
  JOIN public.coach_profiles cp ON cp.id = p.coach_id
  WHERE cp.user_id = (SELECT auth.uid());
$$;

-- 2. The caller's own athlete rows, and the children they are the primary parent of.
CREATE OR REPLACE FUNCTION public.my_practice_log_athlete_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT a.id FROM public.athletes a WHERE a.user_id = (SELECT auth.uid())
  UNION
  SELECT a.id
  FROM public.athletes a
  JOIN public.parent_profiles pp ON pp.id = a.parent_id
  WHERE pp.user_id = (SELECT auth.uid());
$$;

GRANT EXECUTE ON FUNCTION public.my_coach_plan_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_practice_log_athlete_ids() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.my_coach_plan_ids() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_practice_log_athlete_ids() FROM PUBLIC, anon;

-- One policy, so the order of the checks is fixed: the two sets first, and the
-- linked-coach function only for a row neither set already allows. Created
-- before the old four go, so there is no moment with no read policy.
DROP POLICY IF EXISTS "View practice log" ON public.plan_sessions;
CREATE POLICY "View practice log"
  ON public.plan_sessions FOR SELECT TO authenticated
  USING (
    athlete_id IN (SELECT public.my_practice_log_athlete_ids())
    OR plan_id IN (SELECT public.my_coach_plan_ids())
    OR public.shares_athlete_window(athlete_id)
  );

DROP POLICY IF EXISTS "Coaches view sessions for own plans" ON public.plan_sessions;
DROP POLICY IF EXISTS "Athletes view sessions for own plans" ON public.plan_sessions;
DROP POLICY IF EXISTS "Parents view sessions for own athletes" ON public.plan_sessions;
DROP POLICY IF EXISTS "Linked coaches view shared practice log" ON public.plan_sessions;

-- Check after applying (expect 1 row):
--   SELECT policyname, roles, cmd FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'plan_sessions' AND cmd IN ('SELECT', 'ALL');
