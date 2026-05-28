
CREATE OR REPLACE FUNCTION public.is_parent_of_athlete(_athlete_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM athletes a
    JOIN parent_profiles pp ON pp.id = a.parent_id
    WHERE a.id = _athlete_id
      AND pp.user_id = auth.uid()
  );
$$;

DROP POLICY IF EXISTS "Parents can view own coach links" ON public.coach_athletes;
DROP POLICY IF EXISTS "Parents can delete own coach links" ON public.coach_athletes;
DROP POLICY IF EXISTS "Parents can insert coach links for own athletes" ON public.coach_athletes;

CREATE POLICY "Parents can view own coach links"
  ON public.coach_athletes FOR SELECT
  USING (public.is_parent_of_athlete(athlete_id));

CREATE POLICY "Parents can delete own coach links"
  ON public.coach_athletes FOR DELETE
  USING (public.is_parent_of_athlete(athlete_id));

CREATE POLICY "Parents can insert coach links for own athletes"
  ON public.coach_athletes FOR INSERT
  WITH CHECK (public.is_parent_of_athlete(athlete_id));
