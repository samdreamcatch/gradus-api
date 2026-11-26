-- Security re-check, 2026-11-21. Three small gaps, none of which any app
-- screen or server path depends on. Every statement is safe to run twice.
-- No server code changes with this migration; it can be applied on its own.

-- ---------------------------------------------------------------------------
-- 1. Invite-code lookups were callable with the publishable key.
--    Both are SECURITY DEFINER and return a family's or athlete's name for a
--    matching 8-character code. The server throttles lookups by address, but
--    a direct call to the database skipped that throttle and returned the
--    name. The server calls both with the service client
--    (invites.server.ts), so members and signed-out callers need no access.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.get_parent_by_invite_code(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_adult_athlete_by_invite_code(text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_parent_by_invite_code(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_adult_athlete_by_invite_code(text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Yes/no lookups about OTHER people were callable by signed-out callers.
--    Each takes ids chosen by the caller and answers a question about them:
--    is this user an admin, is this user a club admin, is this user in this
--    conversation, did these two users block each other.
--
--    a. Used by row-level policies, which run as the signed-in member, so
--       members keep access. Signed-out callers lose it. No policy that
--       applies to signed-out callers uses any of them. Granted before
--       revoking so members never lose access between statements.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_org_admin(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_direct_room_participant(uuid, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_org_admin(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_direct_room_participant(uuid, uuid) FROM PUBLIC, anon;

--    b. Used by no policy and no member-side call. coaches_linked_for_athlete
--       and team_plan_active are only reached from inside SECURITY DEFINER
--       helpers (shares_athlete_window, can_view_shared_coach_plan,
--       parent_can_write, guardian_can_write_athlete), which run as the
--       owner and keep working. Nobody but the server needs to call these
--       directly.
GRANT EXECUTE ON FUNCTION public.users_blocked(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_any_org_admin(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.coaches_linked_for_athlete(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.team_plan_active(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.users_blocked(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_any_org_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.coaches_linked_for_athlete(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.team_plan_active(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. A member could mark their own profile as a test account.
--    A profile marked as a test account gets no welcome, lifecycle,
--    trial-ending or billing email, has its client error reports dropped,
--    is hidden from the default admin activity and user lists, and can be
--    removed with the admin "delete test user" button. Only the server sets
--    the flag (admin tools use the service client).
--
--    Nothing stopped it on INSERT, and nothing stopped it on UPDATE either:
--    protect_coach_profile_columns and protect_parent_profile_columns mean to
--    reset is_test, but they are SECURITY DEFINER and ask
--    is_privileged_writer(), which looks at current_user. Inside a definer
--    function that is the owner, so the check passes for everyone and the
--    row goes through unchanged. (Same trap noted in 20260905201330 and
--    20261011150000.)
--
--    So this guard is NOT SECURITY DEFINER: is_service_caller() must see the
--    real caller.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_test_flag()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.is_service_caller() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_test IS TRUE THEN
      RAISE EXCEPTION 'The test flag on a profile can only be set by the server'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.is_test IS DISTINCT FROM OLD.is_test THEN
    RAISE EXCEPTION 'The test flag on a profile can only be changed by the server'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_test_flag_on_coach_profiles ON public.coach_profiles;
CREATE TRIGGER protect_test_flag_on_coach_profiles
BEFORE INSERT OR UPDATE ON public.coach_profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_test_flag();

DROP TRIGGER IF EXISTS protect_test_flag_on_parent_profiles ON public.parent_profiles;
CREATE TRIGGER protect_test_flag_on_parent_profiles
BEFORE INSERT OR UPDATE ON public.parent_profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_test_flag();
