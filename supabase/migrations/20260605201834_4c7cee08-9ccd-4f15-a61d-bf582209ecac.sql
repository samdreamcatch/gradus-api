
CREATE POLICY "Athletes update own goals"
ON public.athlete_goals
FOR UPDATE
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.athletes a
  WHERE a.id = athlete_goals.athlete_id AND a.user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.athletes a
  WHERE a.id = athlete_goals.athlete_id AND a.user_id = auth.uid()
));
