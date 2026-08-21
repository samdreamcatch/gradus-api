CREATE POLICY "Guardians can view linked athletes"
ON public.athletes FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.athlete_guardians ag
  JOIN public.parent_profiles pp ON pp.id = ag.parent_id
  WHERE ag.athlete_id = athletes.id AND pp.user_id = (SELECT auth.uid())
));