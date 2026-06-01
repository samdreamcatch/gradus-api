ALTER TABLE public.plan_sessions ALTER COLUMN parent_id DROP NOT NULL;

CREATE POLICY "Athletes insert sessions for own plans"
ON public.plan_sessions FOR INSERT TO authenticated
WITH CHECK (
  parent_id IS NULL
  AND EXISTS (
    SELECT 1 FROM public.athletes a
    WHERE a.id = plan_sessions.athlete_id AND a.user_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1 FROM public.plans p
    WHERE p.id = plan_sessions.plan_id AND p.athlete_id = plan_sessions.athlete_id
  )
);

CREATE POLICY "Athletes view sessions for own plans"
ON public.plan_sessions FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.athletes a
    WHERE a.id = plan_sessions.athlete_id AND a.user_id = auth.uid()
  )
);