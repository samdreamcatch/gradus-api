-- 1) Lock down organization_invite_codes: only admins can read directly.
--    App-user lookups by code are now performed server-side with the admin
--    client inside authenticated server functions.
DROP POLICY IF EXISTS "Authenticated can read active org codes" ON public.organization_invite_codes;

-- 2) Hide Stripe coupon/promo identifiers on promo_codes from authenticated users.
--    Column-level GRANT restricts SELECT to non-sensitive columns; the admin
--    server functions continue to read the full row via supabaseAdmin.
REVOKE SELECT ON public.promo_codes FROM authenticated;
GRANT SELECT (code, label, active, percent_off, notes, created_at, updated_at)
  ON public.promo_codes TO authenticated;
