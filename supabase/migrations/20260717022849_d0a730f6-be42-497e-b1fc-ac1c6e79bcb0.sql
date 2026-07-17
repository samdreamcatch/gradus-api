
-- Effective tier helper: club (org member) > coach_pro > coach (default incl. founding/promo)
CREATE OR REPLACE FUNCTION public.coach_effective_tier(_coach_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN cp.organization_id IS NOT NULL THEN 'club'
    WHEN cp.subscription_tier = 'coach_pro' THEN 'coach_pro'
    ELSE 'coach'
  END
  FROM public.coach_profiles cp
  WHERE cp.id = _coach_id
$$;

GRANT EXECUTE ON FUNCTION public.coach_effective_tier(uuid) TO authenticated, service_role;

-- Roster cap trigger. coach=25, coach_pro=75, club=unlimited.
CREATE OR REPLACE FUNCTION public.enforce_coach_roster_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tier text;
  _count int;
  _cap int;
BEGIN
  _tier := public.coach_effective_tier(NEW.coach_id);
  IF _tier = 'club' THEN
    RETURN NEW;
  END IF;
  _cap := CASE _tier WHEN 'coach_pro' THEN 75 ELSE 25 END;
  SELECT COUNT(*) INTO _count FROM public.coach_athletes WHERE coach_id = NEW.coach_id;
  IF _count >= _cap THEN
    RAISE EXCEPTION 'Roster full: the % plan is limited to % athletes. Upgrade to add more.', _tier, _cap
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_coach_roster_cap ON public.coach_athletes;
CREATE TRIGGER enforce_coach_roster_cap
BEFORE INSERT ON public.coach_athletes
FOR EACH ROW EXECUTE FUNCTION public.enforce_coach_roster_cap();

-- Cross-coach plan visibility for Pro/Club viewers on a shared athlete.
DROP POLICY IF EXISTS "Pro and Club coaches view plans on shared athletes" ON public.plans;
CREATE POLICY "Pro and Club coaches view plans on shared athletes"
ON public.plans
FOR SELECT
TO authenticated
USING (
  kind = 'plan'
  AND status = ANY (ARRAY['active','benched'])
  AND EXISTS (
    SELECT 1
    FROM public.coach_profiles viewer
    JOIN public.coach_athletes viewer_link ON viewer_link.coach_id = viewer.id
    WHERE viewer.user_id = auth.uid()
      AND viewer_link.athlete_id = plans.athlete_id
      AND public.coach_effective_tier(viewer.id) IN ('coach_pro','club')
  )
);
