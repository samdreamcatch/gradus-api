-- Security re-check, 2026-11-21 (applied from supabase/migrations/20261121120000_security_recheck_lookups_and_test_flag.sql).
-- Difference from the saved file: is_any_org_admin keeps EXECUTE for authenticated
-- (the migration tool refuses that revoke); signed-out callers still lose access.
GRANT EXECUTE ON FUNCTION public.get_parent_by_invite_code(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_adult_athlete_by_invite_code(text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_parent_by_invite_code(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_adult_athlete_by_invite_code(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_org_admin(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_direct_room_participant(uuid, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_org_admin(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_direct_room_participant(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.users_blocked(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_any_org_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.coaches_linked_for_athlete(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.team_plan_active(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.users_blocked(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_any_org_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.coaches_linked_for_athlete(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.team_plan_active(uuid) FROM PUBLIC, anon, authenticated;

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
