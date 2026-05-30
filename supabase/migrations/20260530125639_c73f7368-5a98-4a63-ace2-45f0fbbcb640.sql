-- Lock down SECURITY DEFINER functions: revoke broad EXECUTE, grant only where needed.

-- Reset all
REVOKE ALL ON FUNCTION public.activate_plan(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_coach_library(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_parent_of_athlete(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.coach_has_rostered_athlete_of_parent(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

-- App-callable actions: signed-in users only
GRANT EXECUTE ON FUNCTION public.activate_plan(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_coach_library(uuid) TO authenticated;

-- RLS helper functions: needed by policy evaluation for signed-in users
GRANT EXECUTE ON FUNCTION public.is_parent_of_athlete(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.coach_has_rostered_athlete_of_parent(uuid) TO authenticated;

-- update_updated_at_column is a trigger function — no role needs direct EXECUTE.
-- Triggers run with the table owner's privileges regardless.
