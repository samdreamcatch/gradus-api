CREATE OR REPLACE FUNCTION public.sync_guardian_claim_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.guardian_claim_token IS NOT NULL
     AND NEW.guardian_claim_code IS NULL
     AND NEW.parent_id IS NULL
     AND NEW.guardian_claimed_at IS NULL THEN
    NEW.guardian_claim_code := public.new_guardian_claim_code();
  END IF;

  IF NEW.guardian_claim_token IS NULL
     OR NEW.parent_id IS NOT NULL
     OR NEW.guardian_claimed_at IS NOT NULL THEN
    NEW.guardian_claim_code := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_guardian_claim_code ON public.athletes;
CREATE TRIGGER trg_sync_guardian_claim_code
  BEFORE INSERT OR UPDATE ON public.athletes
  FOR EACH ROW EXECUTE FUNCTION public.sync_guardian_claim_code();