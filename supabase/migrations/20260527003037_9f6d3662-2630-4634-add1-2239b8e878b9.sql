
CREATE OR REPLACE FUNCTION public.coach_has_rostered_athlete_of_parent(_parent_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM athletes a
    JOIN coach_athletes ca ON ca.athlete_id = a.id
    JOIN coach_profiles cp ON cp.id = ca.coach_id
    WHERE a.parent_id = _parent_id
      AND cp.user_id = auth.uid()
  );
$$;

DROP POLICY IF EXISTS "Coaches can view parents of rostered athletes" ON public.parent_profiles;

CREATE POLICY "Coaches can view parents of rostered athletes"
ON public.parent_profiles
FOR SELECT
USING (public.coach_has_rostered_athlete_of_parent(id));
