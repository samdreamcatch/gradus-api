
CREATE OR REPLACE FUNCTION public.is_parent_of_plan(_plan_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM plans p
    JOIN athletes a ON a.id = p.athlete_id
    JOIN parent_profiles pp ON pp.id = a.parent_id
    WHERE p.id = _plan_id
      AND pp.user_id = auth.uid()
  );
$$;

CREATE POLICY "Parents view plans for own athletes"
ON public.plans
FOR SELECT
TO authenticated
USING (
  kind = 'plan'
  AND status IN ('active', 'benched')
  AND public.is_parent_of_plan(id)
);

CREATE POLICY "Parents view plan_moves for own athletes"
ON public.plan_moves
FOR SELECT
TO authenticated
USING (public.is_parent_of_plan(plan_id));
