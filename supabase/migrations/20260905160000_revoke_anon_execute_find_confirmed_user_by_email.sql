-- Security fix (2026-09-05).
--
-- public.find_confirmed_user_by_email(text) was callable by the anon and
-- authenticated roles through PostgREST and returned a user id for any
-- confirmed email — an account-enumeration oracle reachable with the public
-- key. Its migration revoked EXECUTE from PUBLIC only, but Supabase's default
-- privileges grant EXECUTE on new functions directly to anon, authenticated
-- and service_role, so the PUBLIC revoke changed nothing for those roles.
--
-- Revoke explicitly and re-grant to service_role alone. Idempotent. Verify
-- with an anonymous PostgREST call to /rest/v1/rpc/find_confirmed_user_by_email,
-- which must now return 401/403 (permission denied), not 200.
REVOKE ALL ON FUNCTION public.find_confirmed_user_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_confirmed_user_by_email(text) TO service_role;
