CREATE OR REPLACE FUNCTION public.athlete_has_sport(_sport text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.athletes a
    WHERE a.user_id = auth.uid()
      AND (
        EXISTS (SELECT 1 FROM public.athlete_goals g
                 WHERE g.athlete_id = a.id AND g.sport = _sport)
        OR EXISTS (SELECT 1 FROM public.coach_athlete_sports cas
                    WHERE cas.athlete_id = a.id AND cas.sport = _sport)
      )
  );
$$;

CREATE POLICY "Athletes read library for their sports"
ON public.resources
FOR SELECT
TO authenticated
USING (coach_id IS NULL AND published = true AND public.athlete_has_sport(sport));