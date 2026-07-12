DROP POLICY IF EXISTS "Anyone signed in can read promo codes" ON public.promo_codes;

CREATE POLICY "Authenticated can read active promo codes"
  ON public.promo_codes
  FOR SELECT
  TO authenticated
  USING (active = true);

REVOKE SELECT ON public.promo_codes FROM authenticated;
GRANT SELECT (code, label, active, created_at, updated_at) ON public.promo_codes TO authenticated;
GRANT ALL ON public.promo_codes TO service_role;