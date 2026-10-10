-- A coach adds an athlete and types a parent email that already belongs to
-- a Gradus parent account (beta feedback 2026-10-07). The server used to
-- treat every guardian as new: the invite said "Create your free parent
-- account", sign-up then failed because the email was taken, and nothing
-- linked. Mariah's call: the parent confirms. Nothing links until they say
-- yes, and they choose whether it's one of their children or a new one (the
-- existing claim and merge flow at /g/<token>).
--
-- This answers one question for the email copy: does this address belong to
-- a parent account whose email is confirmed? Service role only, so it never
-- tells a caller whether someone else has an account.
CREATE OR REPLACE FUNCTION public.parent_account_for_email(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT u.id
  FROM auth.users u
  JOIN public.parent_profiles p ON p.user_id = u.id
  WHERE lower(u.email) = lower(trim(p_email))
    AND u.email_confirmed_at IS NOT NULL
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.parent_account_for_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.parent_account_for_email(text) TO service_role;
