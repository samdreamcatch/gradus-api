-- Lesson wrap-ups are inserted only for athletes on the coach's own roster.
--
-- 20260712084139 added the roster check to the UPDATE policy on lesson_wrap_ups
-- and left INSERT as it was: "Coaches can insert their own wrap-ups" only checks
-- that lesson_wrap_ups.coach_id belongs to the caller. So a coach who knew an
-- athlete's id could insert a wrap-up for an athlete they do not coach. Nobody
-- but that coach can read the row (SELECT is coach-only), but the retention
-- sweep counts the newest lesson_wrap_ups.updated_at for an athlete as activity
-- (src/lib/retention.server.ts, lastActivityAt), whichever coach wrote it. One
-- stray row therefore keeps a dormant minor's account from being swept, or
-- cancels a pending deletion notice.
--
-- INSERT now requires, as UPDATE already does, a coach_athletes row for exactly
-- (lesson_wrap_ups.coach_id, athlete_id). POST /api/v1/coach/wrap-ups does the
-- same check in code (src/lib/lesson-wrap-ups.server.ts).
--
-- Left alone on purpose: UPDATE, SELECT and DELETE, the unique key, and existing
-- rows.
--
-- No function is replaced. Idempotent: safe to re-apply.

DROP POLICY IF EXISTS "Coaches can insert their own wrap-ups" ON public.lesson_wrap_ups;
CREATE POLICY "Coaches can insert their own wrap-ups" ON public.lesson_wrap_ups
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.coach_profiles cp
      WHERE cp.id = lesson_wrap_ups.coach_id AND cp.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.coach_athletes ca
      WHERE ca.coach_id = lesson_wrap_ups.coach_id AND ca.athlete_id = lesson_wrap_ups.athlete_id
    )
  );
