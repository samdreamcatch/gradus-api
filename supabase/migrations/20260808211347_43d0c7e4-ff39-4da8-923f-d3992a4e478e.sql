CREATE POLICY "Athletes view own coach sports"
ON public.coach_athlete_sports FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.athletes a
  WHERE a.id = coach_athlete_sports.athlete_id
    AND a.user_id = auth.uid()
));