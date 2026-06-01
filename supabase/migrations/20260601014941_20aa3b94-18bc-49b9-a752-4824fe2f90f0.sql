CREATE POLICY "Athletes view own plans"
ON public.plans FOR SELECT TO authenticated
USING (
  kind = 'plan'
  AND status = ANY (ARRAY['active','benched'])
  AND EXISTS (SELECT 1 FROM athletes a WHERE a.id = plans.athlete_id AND a.user_id = auth.uid())
);

CREATE POLICY "Athletes view plan_moves for own plans"
ON public.plan_moves FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM plans p JOIN athletes a ON a.id = p.athlete_id
    WHERE p.id = plan_moves.plan_id AND a.user_id = auth.uid()
  )
);