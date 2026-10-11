-- Every UPDATE on public.athletes through a signed-in (RLS) client failed
-- with 42P17 "infinite recursion detected in policy for relation athletes".
-- The WITH CHECK clauses of "Parents can update own athletes"
-- (20260712021433) and "Athletes can update own row" (last rewritten in
-- 20260924200000) compared each locked column with a subquery on athletes
-- itself, e.g. (SELECT a.parent_id FROM public.athletes a WHERE a.id =
-- athletes.id). Postgres applies athletes' own policies to that subquery
-- while it is still expanding them, so it refuses the statement outright.
-- Known casualties: an athlete saving their motivation line
-- (updateAthleteMotivation) and the athlete branch of
-- applyPromoCodeToMyProfile. Every other athlete write uses the service role.
--
-- The column locks move into a BEFORE UPDATE trigger, which compares OLD with
-- NEW directly and reads nothing else (the verification, billing and
-- retention columns already work this way). The policies keep only their
-- ownership checks. Signed-in callers cannot change:
--   user_id, parent_id, self_managed, is_test        (both policies already
--                                                     locked these)
--   guardian_claimed_at, guardian_claim_token,
--   account_state                                    (the athlete policy
--                                                     locked these)
--   guardian_claim_code                              (new: the short form of
--                                                     the claim token, so the
--                                                     same credential)
-- for every signed-in caller, a parent included. No signed-in code path
-- writes any of them: claims, invites, pauses and restores all run as the
-- service role. A parent flipping account_state through PostgREST would skip
-- the consent ledger that the admin restore writes. The trigger is not
-- SECURITY DEFINER on purpose: is_service_caller() looks at current_user,
-- so the service role, migrations and SECURITY DEFINER functions are let
-- through, and anon and authenticated are not.
--
-- "Athletes can view own row" is live in production but missing from this
-- repo: it came from 20260527020340, which was applied and then deleted.
-- It is recreated here with the same definition so that fresh databases
-- match production. Without it an athlete's own UPDATE ... WHERE user_id =
-- auth.uid() matches no rows. In production this is a no-op.

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

-- Named so it fires before trg_sync_guardian_claim_code (BEFORE triggers run
-- in name order); that trigger may fill in a missing claim code itself.
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

-- No policy on athletes may query athletes again.
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
