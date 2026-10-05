-- Practice targets are written only for athletes on the coach's own roster.
--
-- "Coach manages own practice targets" (FOR ALL) only checked that
-- coach_athlete_practice_targets.coach_id belongs to the caller. Nothing checked
-- that the caller coaches athlete_id, so any coach who knew an athlete's id (a
-- UUID, so not guessable, but not a secret either) could upsert a weekly-hours
-- target for them. PUT /api/v1/coach/athletes/{id}/practice-target did no roster
-- check either, so the API let it through. Guardians read every target row for
-- their athlete ("Guardians can read practice targets"); the parent and athlete
-- goals screens only show a target whose coach is the athlete's primary coach for
-- that sport, which a coach who is not on the roster cannot be, but a client that
-- reads the table through RLS would show it. A coach who has since left the
-- roster can still be a stale primary coach (athlete_primary_coaches is not
-- cleared when a coach deletes their own roster link), and could keep rewriting
-- the hours the family sees.
--
-- The policy now also requires, for INSERT and UPDATE, a coach_athletes row for
-- exactly (coach_athlete_practice_targets.coach_id, athlete_id). Same shape as
-- "Coaches manage own plans" (20261005110000) and the lesson_wrap_ups update
-- policy (20260712084139).
--
-- Left alone on purpose:
--   * SELECT and DELETE (USING): a coach can still read and clear their own
--     targets for an athlete who has left, so tidying up stays possible.
--   * The two guardian/athlete SELECT policies and the unique key.
--   * Existing rows. A target written for an athlete who has since left the
--     roster stays as it is; the coach can delete it but not change it.
--
-- No function is replaced. Idempotent: safe to re-apply.

DROP POLICY IF EXISTS "Coach manages own practice targets" ON public.coach_athlete_practice_targets;
CREATE POLICY "Coach manages own practice targets" ON public.coach_athlete_practice_targets
  FOR ALL TO authenticated
  USING (public.caller_owns_coach(coach_id))
  WITH CHECK (
    public.caller_owns_coach(coach_id)
    AND EXISTS (
      SELECT 1 FROM public.coach_athletes ca
      WHERE ca.coach_id = coach_athlete_practice_targets.coach_id
        AND ca.athlete_id = coach_athlete_practice_targets.athlete_id
    )
  );
