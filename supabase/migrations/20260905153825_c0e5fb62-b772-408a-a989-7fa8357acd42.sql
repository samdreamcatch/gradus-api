REVOKE ALL ON FUNCTION public.find_confirmed_user_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_confirmed_user_by_email(text) TO service_role;