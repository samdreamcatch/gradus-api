ALTER TABLE public.athletes
  ADD COLUMN IF NOT EXISTS guardian_email citext,
  ADD COLUMN IF NOT EXISTS guardian_invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS guardian_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS guardian_claim_token text,
  ADD COLUMN IF NOT EXISTS added_by_coach_id uuid REFERENCES public.coach_profiles(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS athletes_guardian_claim_token_key
  ON public.athletes(guardian_claim_token)
  WHERE guardian_claim_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_adult_self_managed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.self_managed IS TRUE THEN
    IF NEW.birthdate IS NULL THEN
      RAISE EXCEPTION 'Self-managed athletes require a birthdate';
    END IF;
    IF (NEW.birthdate + INTERVAL '18 years') > now()
       AND NEW.guardian_email IS NULL
       AND NEW.parent_id IS NULL THEN
      RAISE EXCEPTION 'Athletes under 18 need a parent or guardian email on file'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP POLICY IF EXISTS "Athletes can update own row" ON public.athletes;
CREATE POLICY "Athletes can update own row"
ON public.athletes
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND NOT (user_id IS DISTINCT FROM (SELECT a.user_id FROM public.athletes a WHERE a.id = athletes.id))
  AND NOT (parent_id IS DISTINCT FROM (SELECT a.parent_id FROM public.athletes a WHERE a.id = athletes.id))
  AND NOT (self_managed IS DISTINCT FROM (SELECT a.self_managed FROM public.athletes a WHERE a.id = athletes.id))
  AND NOT (is_test IS DISTINCT FROM (SELECT a.is_test FROM public.athletes a WHERE a.id = athletes.id))
  AND NOT (guardian_claimed_at IS DISTINCT FROM (SELECT a.guardian_claimed_at FROM public.athletes a WHERE a.id = athletes.id))
  AND NOT (guardian_claim_token IS DISTINCT FROM (SELECT a.guardian_claim_token FROM public.athletes a WHERE a.id = athletes.id))
);