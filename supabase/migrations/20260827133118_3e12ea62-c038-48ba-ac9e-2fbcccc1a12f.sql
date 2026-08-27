ALTER TABLE public.athletes ADD COLUMN IF NOT EXISTS guardian_claim_code text;

CREATE UNIQUE INDEX IF NOT EXISTS athletes_guardian_claim_code_key
  ON public.athletes (guardian_claim_code)
  WHERE guardian_claim_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.new_guardian_claim_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate text;
  i int;
  attempts int := 0;
BEGIN
  LOOP
    candidate := '';
    FOR i IN 1..8 LOOP
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.athletes WHERE guardian_claim_code = candidate);
    attempts := attempts + 1;
    IF attempts > 20 THEN
      RAISE EXCEPTION 'Could not generate a unique guardian claim code';
    END IF;
  END LOOP;
  RETURN candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.new_guardian_claim_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.new_guardian_claim_code() TO service_role;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id FROM public.athletes
    WHERE guardian_claim_token IS NOT NULL
      AND guardian_claim_code IS NULL
      AND parent_id IS NULL
      AND guardian_claimed_at IS NULL
  LOOP
    UPDATE public.athletes
      SET guardian_claim_code = public.new_guardian_claim_code()
      WHERE id = r.id;
  END LOOP;
END;
$$;