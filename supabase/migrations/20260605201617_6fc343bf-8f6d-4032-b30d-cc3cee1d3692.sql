
CREATE POLICY "Athletes view own goals"
ON public.athlete_goals
FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.athletes a
  WHERE a.id = athlete_goals.athlete_id AND a.user_id = auth.uid()
));

CREATE POLICY "Athletes view own primary coaches"
ON public.athlete_primary_coaches
FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.athletes a
  WHERE a.id = athlete_primary_coaches.athlete_id AND a.user_id = auth.uid()
));
