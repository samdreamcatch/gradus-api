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
    IF NEW.coach_id IS NULL THEN
      IF TG_TABLE_NAME = 'plans' THEN
        IF NEW.source IS DISTINCT FROM 'gradus' THEN
          RAISE EXCEPTION 'coach_id is required for non-template plans';
        END IF;
      ELSIF TG_TABLE_NAME = 'moves' THEN
        RAISE EXCEPTION 'coach_id is required for non-template moves';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;