-- Athlete-facing policies: evaluate auth.uid() once per query, not per row.
DROP POLICY IF EXISTS "Athletes view own plans" ON public.plans;
CREATE POLICY "Athletes view own plans" ON public.plans
FOR SELECT USING (
  kind = 'plan'
  AND status = ANY (ARRAY['active','benched'])
  AND EXISTS (
    SELECT 1 FROM public.athletes a
    WHERE a.id = plans.athlete_id AND a.user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS "Athletes view sessions for own plans" ON public.plan_sessions;
CREATE POLICY "Athletes view sessions for own plans" ON public.plan_sessions
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.athletes a
    WHERE a.id = plan_sessions.athlete_id AND a.user_id = (SELECT auth.uid())
  )
);

CREATE INDEX IF NOT EXISTS idx_plan_sessions_athlete ON public.plan_sessions (athlete_id);