-- RLS audit, 2026-11-19. Six gaps, each closed here. Every statement is safe
-- to run twice. The server code that reads promo codes and links an adult
-- athlete to a coach moved to the service client in the same change, and
-- works both before and after this migration is applied.

-- ---------------------------------------------------------------------------
-- 1. Email queue wrappers were callable by signed-out callers.
--    They are SECURITY DEFINER and the original migration only revoked
--    EXECUTE from PUBLIC; Supabase's default privileges also grant it to
--    anon and authenticated by name, so those grants survived. Anyone with
--    the publishable key could read, add or delete queued email.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_email(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) TO service_role;

-- Same for the lifecycle job writer. Its only callers are the lifecycle
-- triggers, which are SECURITY DEFINER and so run as the owner.
REVOKE EXECUTE ON FUNCTION public.enqueue_lifecycle_email(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_lifecycle_email(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. An athlete could change their own birthdate and guardian contact.
--    Age gates read athletes.birthdate, so a minor could make themselves an
--    adult. These fields are only ever written by the server.
-- ---------------------------------------------------------------------------
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
     OR NEW.account_state IS DISTINCT FROM OLD.account_state
     OR NEW.birthdate IS DISTINCT FROM OLD.birthdate
     OR NEW.guardian_email IS DISTINCT FROM OLD.guardian_email
     OR NEW.guardian_first_name IS DISTINCT FROM OLD.guardian_first_name
     OR NEW.guardian_last_name IS DISTINCT FROM OLD.guardian_last_name
     OR NEW.guardian_invited_at IS DISTINCT FROM OLD.guardian_invited_at
     OR NEW.added_by_coach_id IS DISTINCT FROM OLD.added_by_coach_id THEN
    RAISE EXCEPTION 'Account, age, link and guardian fields on athletes can only be changed by the server'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Either coach on a visibility link could mark BOTH coaches as accepted,
--    skipping the other coach's opt-in. All writes go through the server
--    (coach-visibility.server.ts), so members only need to read.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Coaches respond to links naming them" ON public.coach_visibility_links;
DROP POLICY IF EXISTS "Parents manage visibility links for their athletes" ON public.coach_visibility_links;
DROP POLICY IF EXISTS "Parents read visibility links for their athletes" ON public.coach_visibility_links;
CREATE POLICY "Parents read visibility links for their athletes"
ON public.coach_visibility_links
FOR SELECT
TO authenticated
USING (athlete_id IN (SELECT public.parent_athlete_ids()));

-- ---------------------------------------------------------------------------
-- 4. Any signed-in member could list every active promo code and its
--    internal notes. Codes are now looked up one at a time by the server.
--    Admin write policies stay; admin screens already read as the server.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can read active promo codes" ON public.promo_codes;

-- ---------------------------------------------------------------------------
-- 5. A parent or self-managed athlete could link the athlete to ANY coach id
--    without that coach's invite code. Roster links are made by the server
--    after it resolves a code. Reading and removing a link are unchanged.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Parents can insert coach links for own athletes" ON public.coach_athletes;
DROP POLICY IF EXISTS "Self-managed athletes insert own coach links" ON public.coach_athletes;

-- ---------------------------------------------------------------------------
-- 6. parent_can_write still called family_plan_active, which was renamed to
--    team_plan_active (20260821234338). Every call raised "function does not
--    exist", so the competition results / skaters / recaps policies that use
--    it failed for parents. Same body, current name.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.parent_can_write(_athlete_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- primary parent always writes
    EXISTS (
      SELECT 1
      FROM public.athletes a
      JOIN public.parent_profiles pp ON pp.id = a.parent_id
      WHERE a.id = _athlete_id AND pp.user_id = (SELECT auth.uid())
    )
    OR (
      -- co-guardian writes only while the household plan is active
      EXISTS (
        SELECT 1
        FROM public.athlete_guardians ag
        JOIN public.parent_profiles pp ON pp.id = ag.parent_id
        WHERE ag.athlete_id = _athlete_id
          AND ag.role = 'co'
          AND pp.user_id = (SELECT auth.uid())
      )
      AND public.team_plan_active(_athlete_id)
    );
$$;