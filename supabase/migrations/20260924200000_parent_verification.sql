-- lovable-cron-fallback-reviewed: new daily retention sweep for milestone S1 (PRD §6.13 A9, §12 #25); same vault-stored service role key and hook shape as the other sweeps.
--
-- Consent backbone (PRD §6.13, decisions #29–#33, milestone S1):
--   1. Parent adult verification columns on parent_profiles. Parents that
--      exist when this runs are marked `legacy` and never prompted (§12 #27).
--   2. `athletes.account_state`: active | provisional | paused (§6.13 A4).
--      Existing rows stay active; only new 13–17 self-sign-ups start
--      provisional (server-set), and only `RESCIND_CONSENT` pauses.
--   3. `guardian_consents`: the consent ledger (§6.13 A3).
--   4. `coach_athletes.messaging_paused_at`: the parent pause (§6.13 C).
--   5. `webhook_receipts`: idempotency and audit for KWS and App Store
--      notifications (§6.13 A2, B4).
--   6. A daily sweep that deletes provisional accounts nobody claimed within
--      3 months (§12 #25). Auth users must go too, so the app does it.
--
-- Every new table is service-role only: the server functions and /api/v1
-- routes write through the admin client after authenticating the caller.

-- 1. Parent adult verification ------------------------------------------------
ALTER TABLE public.parent_profiles
  ADD COLUMN IF NOT EXISTS adult_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS adult_verification_method text,
  ADD COLUMN IF NOT EXISTS adult_verification_ref text,
  ADD COLUMN IF NOT EXISTS adult_verification_requested_at timestamptz;

ALTER TABLE public.parent_profiles
  DROP CONSTRAINT IF EXISTS parent_profiles_adult_verification_method_check;
ALTER TABLE public.parent_profiles
  ADD CONSTRAINT parent_profiles_adult_verification_method_check
  CHECK (adult_verification_method IS NULL OR adult_verification_method IN ('kws_card', 'admin', 'legacy'));

ALTER TABLE public.parent_profiles
  DROP CONSTRAINT IF EXISTS parent_profiles_adult_verification_shape;
ALTER TABLE public.parent_profiles
  ADD CONSTRAINT parent_profiles_adult_verification_shape
  CHECK ((adult_verified_at IS NULL) = (adult_verification_method IS NULL));

-- §12 #27 (Mariah, 2026-09-24): existing parents are left alone.
UPDATE public.parent_profiles
SET adult_verified_at = now(), adult_verification_method = 'legacy'
WHERE adult_verified_at IS NULL;

-- Only the server sets these (the billing-column guard's pattern).
CREATE OR REPLACE FUNCTION public.protect_parent_verification_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.is_service_caller() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.adult_verified_at IS NOT NULL
       OR NEW.adult_verification_method IS NOT NULL
       OR NEW.adult_verification_ref IS NOT NULL
       OR NEW.adult_verification_requested_at IS NOT NULL THEN
      RAISE EXCEPTION 'Verification fields on parent_profiles can only be set by the server'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.adult_verified_at IS DISTINCT FROM OLD.adult_verified_at
     OR NEW.adult_verification_method IS DISTINCT FROM OLD.adult_verification_method
     OR NEW.adult_verification_ref IS DISTINCT FROM OLD.adult_verification_ref
     OR NEW.adult_verification_requested_at IS DISTINCT FROM OLD.adult_verification_requested_at THEN
    RAISE EXCEPTION 'Verification fields on parent_profiles can only be set by the server'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_parent_verification_columns ON public.parent_profiles;
CREATE TRIGGER protect_parent_verification_columns
  BEFORE INSERT OR UPDATE ON public.parent_profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_parent_verification_columns();

-- 2. Athlete account state -----------------------------------------------------
ALTER TABLE public.athletes
  ADD COLUMN IF NOT EXISTS account_state text NOT NULL DEFAULT 'active';

ALTER TABLE public.athletes
  DROP CONSTRAINT IF EXISTS athletes_account_state_check;
ALTER TABLE public.athletes
  ADD CONSTRAINT athletes_account_state_check
  CHECK (account_state IN ('active', 'provisional', 'paused'));

CREATE INDEX IF NOT EXISTS athletes_provisional_created_idx
  ON public.athletes (created_at)
  WHERE account_state = 'provisional';

-- An athlete's own session can never change its state (same locked-column
-- shape as 20260813002738, plus account_state).
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
  AND NOT (account_state IS DISTINCT FROM (SELECT a.account_state FROM public.athletes a WHERE a.id = athletes.id))
);

-- 3. Consent ledger --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guardian_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  -- Nullable on purpose: when a parent deletes their account the row is
  -- revoked (reason parent_account_deleted) and kept as the record of the
  -- consent that existed; only the athlete's own erasure removes it.
  parent_id uuid REFERENCES public.parent_profiles(id) ON DELETE SET NULL,
  scope text NOT NULL CHECK (scope IN ('account', 'messaging')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_reason text,
  -- How the consent was given: parent_created | guardian_claim | admin
  method text NOT NULL,
  -- What backs it: the parent's verification method and ref at grant time,
  -- the claim token id, the seeder name. Never card data (KWS keeps that).
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS guardian_consents_athlete_scope_idx
  ON public.guardian_consents (athlete_id, scope)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS guardian_consents_parent_idx
  ON public.guardian_consents (parent_id);

ALTER TABLE public.guardian_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guardian_consents FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.guardian_consents TO service_role;

-- 4. Parent pause on a coach link ------------------------------------------------
-- Client updates on coach_athletes are already denied outright (RESTRICTIVE
-- "No updates to coach_athletes links"), so the server is the only writer.
ALTER TABLE public.coach_athletes
  ADD COLUMN IF NOT EXISTS messaging_paused_at timestamptz;

-- 5. Webhook receipts --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.webhook_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- kws | kws_redirect | app_store
  source text NOT NULL,
  -- The provider's own id for the event (KWS transactionId, App Store
  -- notificationUUID): a retried delivery inserts nothing twice.
  external_id text NOT NULL,
  event text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (source, external_id)
);

ALTER TABLE public.webhook_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_receipts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.webhook_receipts TO service_role;

-- 6. Retention sweep (§12 #25: 3 months) -----------------------------------------
DO $$ BEGIN PERFORM cron.unschedule('consent-retention-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'consent-retention-daily',
  '23 4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--d9b69d11-663e-4423-8783-c75a42c0e56f.lovable.app/api/public/hooks/consent-retention',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);
