-- 1. athlete_goals: require athlete to be on coach's roster
DROP POLICY IF EXISTS "Coaches view goals for rostered athletes" ON public.athlete_goals;
CREATE POLICY "Coaches view goals for rostered athletes"
ON public.athlete_goals
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM coach_profiles cp
    JOIN coach_athletes ca ON ca.coach_id = cp.id
    WHERE cp.id = athlete_goals.coach_id
      AND cp.user_id = auth.uid()
      AND ca.athlete_id = athlete_goals.athlete_id
  )
);

-- 2. athlete_lesson_slots: same fix
DROP POLICY IF EXISTS "Coaches view slots for rostered athletes" ON public.athlete_lesson_slots;
CREATE POLICY "Coaches view slots for rostered athletes"
ON public.athlete_lesson_slots
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM coach_profiles cp
    JOIN coach_athletes ca ON ca.coach_id = cp.id
    WHERE cp.id = athlete_lesson_slots.coach_id
      AND cp.user_id = auth.uid()
      AND ca.athlete_id = athlete_lesson_slots.athlete_id
  )
);

-- 3. plan_moves parent SELECT: restrict to active/benched real plans
DROP POLICY IF EXISTS "Parents view plan_moves for own athletes" ON public.plan_moves;
CREATE POLICY "Parents view plan_moves for own athletes"
ON public.plan_moves
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM plans p
    JOIN athletes a ON a.id = p.athlete_id
    JOIN parent_profiles pp ON pp.id = a.parent_id
    WHERE p.id = plan_moves.plan_id
      AND pp.user_id = auth.uid()
      AND p.kind = 'plan'
      AND p.status = ANY (ARRAY['active','benched'])
  )
);