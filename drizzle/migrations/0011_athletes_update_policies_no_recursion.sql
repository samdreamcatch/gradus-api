CREATE OR REPLACE FUNCTION public.protect_athlete_locked_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.is_service_caller() THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
     OR NEW.self_managed IS DISTINCT FROM OLD.self_managed
     OR NEW.is_test IS DISTINCT FROM OLD.is_test
     OR NEW.guardian_claimed_at IS DISTINCT FROM OLD.guardian_claimed_at
     OR NEW.guardian_claim_token IS DISTINCT FROM OLD.guardian_claim_token
     OR NEW.guardian_claim_code IS DISTINCT FROM OLD.guardian_claim_code
     OR NEW.account_state IS DISTINCT FROM OLD.account_state THEN
    RAISE EXCEPTION 'Account, link and guardian claim fields on athletes can only be changed by the server'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_athlete_locked_columns ON public.athletes;
CREATE TRIGGER protect_athlete_locked_columns
  BEFORE UPDATE ON public.athletes
  FOR EACH ROW EXECUTE FUNCTION public.protect_athlete_locked_columns();

DROP POLICY IF EXISTS "Parents can update own athletes" ON public.athletes;
CREATE POLICY "Parents can update own athletes"
ON public.athletes
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.parent_profiles pp
    WHERE pp.id = athletes.parent_id AND pp.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.parent_profiles pp
    WHERE pp.id = athletes.parent_id AND pp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Athletes can update own row" ON public.athletes;
CREATE POLICY "Athletes can update own row"
ON public.athletes
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Athletes can view own row" ON public.athletes;
CREATE POLICY "Athletes can view own row"
ON public.athletes
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DO $$
DECLARE
  offender text;
BEGIN
  SELECT string_agg(policyname, ', ')
    INTO offender
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'athletes'
     AND concat_ws(' ', qual, with_check) ~* '\m(from|join)\s+(public\.)?athletes\M';
  IF offender IS NOT NULL THEN
    RAISE EXCEPTION 'Policies on athletes still query athletes: %', offender;
  END IF;
END;
$$;