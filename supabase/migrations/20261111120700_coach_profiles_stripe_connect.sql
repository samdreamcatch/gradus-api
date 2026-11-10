-- Stripe Connect for coaches who sell plans (src/lib/stripe-connect.server.ts):
-- each coach gets one Express connected account; buyers' payments for their
-- plans will be routed to it. The status columns mirror the account as Stripe
-- last reported it (on the coach's return from onboarding, and on the
-- `account.updated` webhook), so the apps can show "Connected" without a
-- Stripe call per page.
--
-- All optional (nullable, no NOT NULL), so existing rows and the live app are
-- untouched: every existing coach reads as "not connected" (NULL).
-- The columns ride on the existing table grants and RLS policies on
-- coach_profiles; the trigger below keeps them server-written only, like the
-- billing columns (20260905200000_protect_billing_columns), so a coach can't
-- mark their own account ready for payouts.
ALTER TABLE public.coach_profiles
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id text,
  ADD COLUMN IF NOT EXISTS stripe_connect_details_submitted boolean,
  ADD COLUMN IF NOT EXISTS stripe_connect_charges_enabled boolean,
  ADD COLUMN IF NOT EXISTS stripe_connect_payouts_enabled boolean,
  ADD COLUMN IF NOT EXISTS stripe_connect_updated_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS coach_profiles_stripe_connect_account_id_key
  ON public.coach_profiles (stripe_connect_account_id)
  WHERE stripe_connect_account_id IS NOT NULL;

COMMENT ON COLUMN public.coach_profiles.stripe_connect_account_id IS
  'The coach''s Stripe Connect Express account (acct_…); NULL until they start connecting. Server-written only.';
COMMENT ON COLUMN public.coach_profiles.stripe_connect_details_submitted IS
  'Stripe: the coach finished the onboarding form; NULL until synced (read as false). Server-written only.';
COMMENT ON COLUMN public.coach_profiles.stripe_connect_charges_enabled IS
  'Stripe: the account can take payments; NULL until synced (read as false). Server-written only.';
COMMENT ON COLUMN public.coach_profiles.stripe_connect_payouts_enabled IS
  'Stripe: the account can be paid out; NULL until synced (read as false). Server-written only.';
COMMENT ON COLUMN public.coach_profiles.stripe_connect_updated_at IS
  'When the status columns were last synced from Stripe.';

-- SECURITY INVOKER on purpose (like protect_coach_billing_columns): the guard
-- must see the real caller, and is_service_caller() is true only for the
-- server and migrations.
CREATE OR REPLACE FUNCTION public.protect_coach_stripe_connect_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.is_service_caller() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.stripe_connect_account_id IS NOT NULL
       OR NEW.stripe_connect_details_submitted IS NOT NULL
       OR NEW.stripe_connect_charges_enabled IS NOT NULL
       OR NEW.stripe_connect_payouts_enabled IS NOT NULL
       OR NEW.stripe_connect_updated_at IS NOT NULL THEN
      RAISE EXCEPTION 'Stripe Connect columns are set by the server.' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.stripe_connect_account_id IS DISTINCT FROM OLD.stripe_connect_account_id
        OR NEW.stripe_connect_details_submitted IS DISTINCT FROM OLD.stripe_connect_details_submitted
        OR NEW.stripe_connect_charges_enabled IS DISTINCT FROM OLD.stripe_connect_charges_enabled
        OR NEW.stripe_connect_payouts_enabled IS DISTINCT FROM OLD.stripe_connect_payouts_enabled
        OR NEW.stripe_connect_updated_at IS DISTINCT FROM OLD.stripe_connect_updated_at THEN
    RAISE EXCEPTION 'Stripe Connect columns are set by the server.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_stripe_connect_columns_on_coach_profiles ON public.coach_profiles;
CREATE TRIGGER protect_stripe_connect_columns_on_coach_profiles
  BEFORE INSERT OR UPDATE ON public.coach_profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_coach_stripe_connect_columns();
