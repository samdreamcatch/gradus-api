
REVOKE EXECUTE ON FUNCTION public.coach_has_rostered_athlete_of_parent(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_has_rostered_athlete_of_parent(uuid) TO authenticated;
