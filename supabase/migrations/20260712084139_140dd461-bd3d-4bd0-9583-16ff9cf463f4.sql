
-- coach_levels
DROP POLICY IF EXISTS "Coaches can update own levels" ON public.coach_levels;
CREATE POLICY "Coaches can update own levels" ON public.coach_levels
FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.coach_profiles cp WHERE cp.id = coach_levels.coach_id AND cp.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.coach_profiles cp WHERE cp.id = coach_levels.coach_id AND cp.user_id = auth.uid()));

-- lesson_wrap_ups: enforce athlete_id stays on coach's roster
DROP POLICY IF EXISTS "Coaches can update their own wrap-ups" ON public.lesson_wrap_ups;
CREATE POLICY "Coaches can update their own wrap-ups" ON public.lesson_wrap_ups
FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.coach_profiles cp WHERE cp.id = lesson_wrap_ups.coach_id AND cp.user_id = auth.uid()))
WITH CHECK (
  EXISTS (SELECT 1 FROM public.coach_profiles cp WHERE cp.id = lesson_wrap_ups.coach_id AND cp.user_id = auth.uid())
  AND EXISTS (SELECT 1 FROM public.coach_athletes ca WHERE ca.coach_id = lesson_wrap_ups.coach_id AND ca.athlete_id = lesson_wrap_ups.athlete_id)
);

-- moves
DROP POLICY IF EXISTS "Coaches manage own moves - update" ON public.moves;
CREATE POLICY "Coaches manage own moves - update" ON public.moves
FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.coach_profiles cp WHERE cp.id = moves.coach_id AND cp.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.coach_profiles cp WHERE cp.id = moves.coach_id AND cp.user_id = auth.uid()));

-- plan_moves
DROP POLICY IF EXISTS "Coaches manage own plan_moves - update" ON public.plan_moves;
CREATE POLICY "Coaches manage own plan_moves - update" ON public.plan_moves
FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.plans p JOIN public.coach_profiles cp ON cp.id = p.coach_id WHERE p.id = plan_moves.plan_id AND cp.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.plans p JOIN public.coach_profiles cp ON cp.id = p.coach_id WHERE p.id = plan_moves.plan_id AND cp.user_id = auth.uid()));

-- plans
DROP POLICY IF EXISTS "Coaches manage own plans - update" ON public.plans;
CREATE POLICY "Coaches manage own plans - update" ON public.plans
FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.coach_profiles cp WHERE cp.id = plans.coach_id AND cp.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.coach_profiles cp WHERE cp.id = plans.coach_id AND cp.user_id = auth.uid()));
