-- 1. Signed-in users: restore read access, safe columns only.
--    (The Stripe coupon/promo ID columns are deliberately excluded.)
GRANT SELECT (
  code,
  label,
  active,
  notes,
  percent_off,
  duration,
  duration_in_months,
  card_required,
  applies_to_plans,
  created_at,
  updated_at
) ON public.promo_codes TO authenticated;

-- 2. Logged-out visitors: no access at all. No policy grants anon anything
--    and no code path reads promo codes as anon.
REVOKE ALL ON public.promo_codes FROM anon;

-- 3. Make sure admin/server paths keep full access.
GRANT ALL ON public.promo_codes TO service_role;