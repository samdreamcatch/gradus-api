-- Restrict sensitive columns from general authenticated read access.
-- These columns are only needed server-side (via service_role) — client
-- reads never select them.

REVOKE SELECT (notes) ON public.organizations FROM authenticated;
REVOKE SELECT (notes) ON public.organizations FROM anon;

REVOKE SELECT (
  stripe_coupon_id_sandbox,
  stripe_promo_id_sandbox,
  stripe_coupon_id_live,
  stripe_promo_id_live
) ON public.promo_codes FROM authenticated;

REVOKE SELECT (
  stripe_coupon_id_sandbox,
  stripe_promo_id_sandbox,
  stripe_coupon_id_live,
  stripe_promo_id_live
) ON public.promo_codes FROM anon;
