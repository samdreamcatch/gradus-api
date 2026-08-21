CREATE OR REPLACE FUNCTION public.sync_primary_guardian()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    INSERT INTO public.athlete_guardians (athlete_id, parent_id, role)
    VALUES (NEW.id, NEW.parent_id, 'primary')
    ON CONFLICT (athlete_id, parent_id) DO UPDATE SET role = 'primary';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.parent_id IS NOT NULL AND OLD.parent_id IS DISTINCT FROM NEW.parent_id THEN
    DELETE FROM public.athlete_guardians
    WHERE athlete_id = NEW.id AND parent_id = OLD.parent_id AND role = 'primary';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_primary_guardian ON public.athletes;
CREATE TRIGGER sync_primary_guardian
AFTER INSERT OR UPDATE OF parent_id ON public.athletes
FOR EACH ROW EXECUTE FUNCTION public.sync_primary_guardian();