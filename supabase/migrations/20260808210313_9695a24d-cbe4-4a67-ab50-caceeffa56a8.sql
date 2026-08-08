REVOKE EXECUTE ON FUNCTION public.athlete_has_sport(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.athlete_has_sport(text) TO authenticated;