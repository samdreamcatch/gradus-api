
ALTER TABLE public.coach_profiles
  ADD COLUMN IF NOT EXISTS subscription_tier text,
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_environment text;

ALTER TABLE public.coach_profiles
  DROP CONSTRAINT IF EXISTS coach_profiles_subscription_tier_check;

ALTER TABLE public.coach_profiles
  ADD CONSTRAINT coach_profiles_subscription_tier_check
  CHECK (subscription_tier IS NULL OR subscription_tier IN ('coach', 'coach_pro'));

ALTER TABLE public.coach_profiles
  DROP CONSTRAINT IF EXISTS coach_profiles_subscription_environment_check;

ALTER TABLE public.coach_profiles
  ADD CONSTRAINT coach_profiles_subscription_environment_check
  CHECK (subscription_environment IS NULL OR subscription_environment IN ('sandbox', 'live'));

CREATE INDEX IF NOT EXISTS coach_profiles_stripe_subscription_id_idx
  ON public.coach_profiles(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS coach_profiles_stripe_customer_id_idx
  ON public.coach_profiles(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
