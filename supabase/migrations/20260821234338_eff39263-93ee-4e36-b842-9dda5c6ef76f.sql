ALTER FUNCTION public.family_plan_active(uuid) RENAME TO team_plan_active;

CREATE OR REPLACE FUNCTION public.guardian_can_write_athlete(_athlete_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_parent_of_athlete(_athlete_id)
    OR (
      EXISTS (
        SELECT 1
        FROM public.athlete_guardians ag
        JOIN public.parent_profiles pp ON pp.id = ag.parent_id
        WHERE ag.athlete_id = _athlete_id
          AND ag.role = 'co'
          AND pp.user_id = (SELECT auth.uid())
      )
      AND public.team_plan_active(_athlete_id)
    );
$$;