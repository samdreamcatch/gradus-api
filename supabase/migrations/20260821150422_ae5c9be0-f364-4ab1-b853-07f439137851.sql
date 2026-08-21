CREATE OR REPLACE FUNCTION public.is_privileged_writer()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT current_user IN ('service_role', 'postgres', 'supabase_admin')
     OR coalesce(auth.jwt() ->> 'role', '') = 'service_role';
$$;

REVOKE EXECUTE ON FUNCTION public.is_privileged_writer() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_coach_profile_columns() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_parent_profile_columns() FROM anon, authenticated;