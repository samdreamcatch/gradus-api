
-- Backfill Founding Coach status for all coaches onboarded before Sept 1, 2026.
-- Any coach who has completed onboarding and is not already covered by an
-- active paid subscription or a club is stamped as founding + promo_free.
UPDATE public.coach_profiles
SET founding_coach = true,
    entitlement = CASE
      WHEN entitlement IN ('paid', 'club_covered') THEN entitlement
      ELSE 'promo_free'
    END
WHERE onboarded_at IS NOT NULL
  AND onboarded_at < '2026-09-01T00:00:00Z'
  AND organization_id IS NULL
  AND (subscription_status IS NULL OR subscription_status NOT IN ('active','trialing','past_due'))
  AND (founding_coach IS DISTINCT FROM true OR entitlement = 'pending');
