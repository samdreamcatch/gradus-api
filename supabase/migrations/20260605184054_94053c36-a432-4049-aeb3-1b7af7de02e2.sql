
-- 1) Clean up June Cleaver's stale stub coach profile.
DELETE FROM public.coach_profiles
WHERE user_id = 'f5845b01-2253-4f75-b651-cdfbf781d111'
  AND onboarded_at IS NULL;

-- 2) Defense-in-depth: forbid a user from having both a coach and parent profile.
CREATE OR REPLACE FUNCTION public.prevent_dual_role_coach()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.parent_profiles WHERE user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'This account is registered as a parent, not a coach.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_dual_role_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.coach_profiles WHERE user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'This account is registered as a coach, not a parent.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_dual_role_coach() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_dual_role_parent() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS prevent_dual_role_on_coach_profiles ON public.coach_profiles;
CREATE TRIGGER prevent_dual_role_on_coach_profiles
  BEFORE INSERT ON public.coach_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_dual_role_coach();

DROP TRIGGER IF EXISTS prevent_dual_role_on_parent_profiles ON public.parent_profiles;
CREATE TRIGGER prevent_dual_role_on_parent_profiles
  BEFORE INSERT ON public.parent_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_dual_role_parent();
