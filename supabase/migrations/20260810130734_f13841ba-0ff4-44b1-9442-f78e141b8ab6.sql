CREATE OR REPLACE FUNCTION public.validate_org_template_ownership()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_org_template THEN
    IF NEW.organization_id IS NULL THEN
      RAISE EXCEPTION 'Org templates require organization_id';
    END IF;
    IF NEW.coach_id IS NOT NULL THEN
      RAISE EXCEPTION 'Org templates must not set coach_id';
    END IF;
  ELSE
    IF NEW.coach_id IS NULL
       AND TG_TABLE_NAME IN ('moves','plans')
       AND NOT (TG_TABLE_NAME = 'plans' AND NEW.source = 'gradus') THEN
      RAISE EXCEPTION 'coach_id is required for non-template %', TG_TABLE_NAME;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;