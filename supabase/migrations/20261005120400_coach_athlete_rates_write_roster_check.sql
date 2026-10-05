-- Athlete rates are written only for athletes on the coach's own roster.
--
-- "Coaches manage own athlete rates" (FOR ALL) only checked that
-- coach_athlete_rates.coach_id belongs to the caller, so a coach who knew an
-- athlete's id could upsert a rate for an athlete they do not coach. The row is
-- readable by nobody but that coach and feeds only that coach's own invoice
-- drafts, and setAthleteRate already checks the roster in code, so nothing
-- visible changes; this closes the same gap as the other coach-owned tables
-- (plans, practice targets, wrap-ups, invoices) so that every one of them
-- holds the line in the database, not only in the API.
--
-- INSERT and UPDATE now also require a coach_athletes row for exactly
-- (coach_athlete_rates.coach_id, athlete_id). SELECT and DELETE (USING) are
-- unchanged, so a coach can still read and clear a rate after an athlete leaves.
-- Existing rows are left as they are.
--
-- No function is replaced. Idempotent: safe to re-apply.

DROP POLICY IF EXISTS "Coaches manage own athlete rates" ON public.coach_athlete_rates;
CREATE POLICY "Coaches manage own athlete rates" ON public.coach_athlete_rates
  FOR ALL TO authenticated
  USING (public.caller_owns_coach(coach_id))
  WITH CHECK (
    public.caller_owns_coach(coach_id)
    AND EXISTS (
      SELECT 1 FROM public.coach_athletes ca
      WHERE ca.coach_id = coach_athlete_rates.coach_id
        AND ca.athlete_id = coach_athlete_rates.athlete_id
    )
  );
