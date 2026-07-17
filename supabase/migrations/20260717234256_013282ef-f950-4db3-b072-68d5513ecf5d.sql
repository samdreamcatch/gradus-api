CREATE OR REPLACE FUNCTION public.enforce_coach_roster_cap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tier text;
  _count int;
  _cap int;
BEGIN
  _tier := public.coach_effective_tier(NEW.coach_id);
  IF _tier = 'club' THEN
    RETURN NEW;
  END IF;
  _cap := CASE _tier WHEN 'coach_pro' THEN 50 ELSE 5 END;
  SELECT COUNT(*) INTO _count FROM public.coach_athletes WHERE coach_id = NEW.coach_id;
  IF _count >= _cap THEN
    RAISE EXCEPTION 'Roster full: the % plan is limited to % athletes. Upgrade to add more.', _tier, _cap
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;