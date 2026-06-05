-- Tighten EXECUTE on SECURITY DEFINER functions: revoke broad PUBLIC grants
-- and re-grant only to the roles that actually need to call each function.

-- Trigger-only functions: no direct EXECUTE needed by any client role.
REVOKE ALL ON FUNCTION public.validate_athlete_primary_coach() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_coach_athlete_sport() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_coach_athlete_sports() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_message_plan() FROM PUBLIC, anon, authenticated;

-- RLS helpers: must be callable by authenticated users inside policies.
REVOKE ALL ON FUNCTION public.is_parent_of_athlete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_parent_of_athlete(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.is_parent_of_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_parent_of_plan(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.is_room_participant(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_room_participant(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.coach_has_rostered_athlete_of_parent(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_has_rostered_athlete_of_parent(uuid) TO authenticated;

-- User-invoked actions: signed-in users only; each function checks auth.uid() internally.
REVOKE ALL ON FUNCTION public.activate_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_plan(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.seed_coach_library(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_coach_library(uuid) TO authenticated;

-- Called only via supabaseAdmin (service role) for rate-limited invite lookups.
REVOKE ALL ON FUNCTION public.record_invite_lookup_attempt(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_invite_lookup_attempt(text, text, integer, integer) TO service_role;