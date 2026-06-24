
ALTER TABLE public.athletes ADD COLUMN username citext UNIQUE;
COMMENT ON COLUMN public.athletes.username IS 'Globally-unique username for username/password athletes (no email). Synthetic email is stored in auth.users.';

-- Lookup function: resolve a username to its athlete's auth user_id without
-- exposing the auth schema or letting clients enumerate. SECURITY DEFINER
-- so the public (anon) caller can use it via RPC for login.
CREATE OR REPLACE FUNCTION public.resolve_athlete_username(_username citext)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id FROM public.athletes WHERE username = _username AND user_id IS NOT NULL LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_athlete_username(citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_athlete_username(citext) TO anon, authenticated, service_role;
