
-- Founding Coach flag + one-time Pro trial tracking
ALTER TABLE public.coach_profiles
  ADD COLUMN IF NOT EXISTS founding_coach boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS founding_pro_trial_used boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS founding_pro_trial_started_at timestamptz;

-- Backfill: every real (non-test) coach profile becomes a founding coach
UPDATE public.coach_profiles cp
SET founding_coach = true
FROM auth.users u
WHERE u.id = cp.user_id
  AND u.email IS NOT NULL
  AND u.email NOT ILIKE '%@test.dev'
  AND u.email NOT ILIKE '%@test.gradus.app';

-- Any real coach who is still pending and has no subscription becomes promo_free
UPDATE public.coach_profiles cp
SET entitlement = 'promo_free'
FROM auth.users u
WHERE u.id = cp.user_id
  AND cp.founding_coach = true
  AND cp.entitlement = 'pending'
  AND cp.stripe_subscription_id IS NULL
  AND cp.organization_id IS NULL;

-- Flip 3-month delayed-charge codes to card-not-required at checkout
UPDATE public.promo_codes
SET card_required = false
WHERE code IN ('WILSON','PRACTICE','WELCOME_BACK');
