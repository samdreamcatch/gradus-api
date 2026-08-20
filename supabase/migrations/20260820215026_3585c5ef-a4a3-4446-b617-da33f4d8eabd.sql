-- Make plan_moves read policies use an initplan for the current user id so the
-- check is evaluated once per query instead of once per row.

DROP POLICY IF EXISTS "Athletes view plan_moves for own plans" ON public.plan_moves;
CREATE POLICY "Athletes view plan_moves for own plans"
  ON public.plan_moves FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.plans p
    JOIN public.athletes a ON a.id = p.athlete_id
    WHERE p.id = plan_moves.plan_id
      AND a.user_id = (SELECT auth.uid())
      AND p.kind = 'plan'
      AND p.status = ANY (ARRAY['active','benched'])
  ));

DROP POLICY IF EXISTS "Coaches manage own plan_moves - select" ON public.plan_moves;
CREATE POLICY "Coaches manage own plan_moves - select"
  ON public.plan_moves FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.plans p
    JOIN public.coach_profiles cp ON cp.id = p.coach_id
    WHERE p.id = plan_moves.plan_id
      AND cp.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Coaches view gradus plan_moves for rostered athletes" ON public.plan_moves;
CREATE POLICY "Coaches view gradus plan_moves for rostered athletes"
  ON public.plan_moves FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.plans p
    JOIN public.coach_profiles cp ON cp.user_id = (SELECT auth.uid())
    JOIN public.coach_athletes ca ON ca.coach_id = cp.id AND ca.athlete_id = p.athlete_id
    WHERE p.id = plan_moves.plan_id
      AND p.source = 'gradus'
      AND p.kind = 'plan'
      AND p.status = ANY (ARRAY['active','benched'])
  ));

DROP POLICY IF EXISTS "Parents view plan_moves for own athletes" ON public.plan_moves;
CREATE POLICY "Parents view plan_moves for own athletes"
  ON public.plan_moves FOR SELECT TO authenticated
  USING (
    public.is_parent_of_plan(plan_id)
    AND EXISTS (
      SELECT 1 FROM public.plans p
      WHERE p.id = plan_moves.plan_id
        AND p.kind = 'plan'
        AND p.status = ANY (ARRAY['active','benched'])
    )
  );

-- Supporting indexes for the joins used above.
CREATE INDEX IF NOT EXISTS idx_coach_profiles_user ON public.coach_profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_athletes_user ON public.athletes (user_id);
CREATE INDEX IF NOT EXISTS idx_coach_athletes_coach_athlete ON public.coach_athletes (coach_id, athlete_id);
CREATE INDEX IF NOT EXISTS idx_plans_athlete ON public.plans (athlete_id);

ANALYZE public.plan_moves;
ANALYZE public.plans;