-- Coach plan writes must stay inside the coach's own roster.
--
-- "Coaches manage own plans - insert" and "... - update" only checked that
-- plans.coach_id belongs to the caller. Nothing checked that the caller coaches
-- plans.athlete_id, so a coach who knew an athlete's id (a UUID, so not
-- guessable, but not a secret either) could INSERT an active plan for an athlete
-- they do not coach, or UPDATE one of their own plans to point at them. The
-- athlete's guardians and the athlete then read it as a plan from their coach
-- ("Parents view plans for own athletes" / "Athletes view own plans"). The same
-- check was added to the lesson_wrap_ups update policy in 20260712084139.
--
-- Both policies now also require, whenever athlete_id is set, a coach_athletes
-- row for exactly (plans.coach_id, plans.athlete_id).
--
-- Left alone on purpose:
--   * Templates and drafts with no athlete (athlete_id IS NULL).
--   * Rows with no coach_id (Gradus starter plans, org templates, and the
--     athlete-authored source = 'athlete' rows): neither coach policy ever
--     matched them, and they are written by the service role or by their own
--     policies. Competition drafts and starter-plan adoption are written with
--     the service role, which bypasses RLS; their routes check the roster in
--     code (competition-results.server.ts, starter-programs.server.ts).
--   * USING, DELETE, SELECT, and the role each policy applies to.
--   * Existing rows. A plan whose athlete has since left the coach's roster is
--     now read-only for that coach through RLS: no edits, no status changes. The
--     app still lets that coach take such a plan down (active to benched or
--     draft, nothing else) through the server in plans.server.ts setPlanStatus,
--     which writes with the service role after its own checks. At the database
--     level the coach can still detach it (athlete_id = NULL) or delete it.
--
-- No function is replaced. Idempotent: safe to re-apply.

DROP POLICY IF EXISTS "Coaches manage own plans - insert" ON public.plans;
CREATE POLICY "Coaches manage own plans - insert" ON public.plans
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.coach_profiles cp
      WHERE cp.id = plans.coach_id AND cp.user_id = auth.uid()
    )
    AND (
      plans.athlete_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.coach_athletes ca
        WHERE ca.coach_id = plans.coach_id AND ca.athlete_id = plans.athlete_id
      )
    )
  );

-- No TO clause, as in 20260712084139: the policy keeps applying to PUBLIC.
DROP POLICY IF EXISTS "Coaches manage own plans - update" ON public.plans;
CREATE POLICY "Coaches manage own plans - update" ON public.plans
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.coach_profiles cp
      WHERE cp.id = plans.coach_id AND cp.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.coach_profiles cp
      WHERE cp.id = plans.coach_id AND cp.user_id = auth.uid()
    )
    AND (
      plans.athlete_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.coach_athletes ca
        WHERE ca.coach_id = plans.coach_id AND ca.athlete_id = plans.athlete_id
      )
    )
  );
