DROP POLICY IF EXISTS "Athletes insert sessions for own plans" ON public.plan_sessions;

CREATE POLICY "Athletes insert sessions for own plans"
ON public.plan_sessions
FOR INSERT
TO authenticated
WITH CHECK (
  parent_id IS NULL
  AND EXISTS (
    SELECT 1 FROM public.athletes a
    WHERE a.id = plan_sessions.athlete_id
      AND a.user_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1 FROM public.plans p
    WHERE p.id = plan_sessions.plan_id
      AND p.athlete_id = plan_sessions.athlete_id
      AND p.kind = 'plan'
      AND p.status IN ('active', 'benched')
  )
);