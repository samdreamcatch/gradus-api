
ALTER TABLE public.promo_codes
  ADD COLUMN IF NOT EXISTS duration text NOT NULL DEFAULT 'forever',
  ADD COLUMN IF NOT EXISTS duration_in_months integer;

ALTER TABLE public.promo_codes
  DROP CONSTRAINT IF EXISTS promo_codes_duration_check;
ALTER TABLE public.promo_codes
  ADD CONSTRAINT promo_codes_duration_check
  CHECK (duration IN ('forever', 'repeating'));

ALTER TABLE public.promo_codes
  DROP CONSTRAINT IF EXISTS promo_codes_duration_in_months_check;
ALTER TABLE public.promo_codes
  ADD CONSTRAINT promo_codes_duration_in_months_check
  CHECK (
    (duration = 'repeating' AND duration_in_months IS NOT NULL AND duration_in_months > 0)
    OR (duration = 'forever' AND duration_in_months IS NULL)
  );

REVOKE SELECT ON public.promo_codes FROM authenticated;
GRANT SELECT (
  code, label, active, percent_off, duration, duration_in_months, notes, created_at, updated_at
) ON public.promo_codes TO authenticated;

INSERT INTO public.promo_codes (code, label, notes, percent_off, duration, duration_in_months, active)
VALUES
  ('WILSON',   '3 months free of Coach Pro', 'Coach Pro only. Card required, auto-converts to $70/mo.', 100, 'repeating', 3, true),
  ('PRACTICE', '3 months free of Coach Pro', 'Coach Pro only. Card required, auto-converts to $70/mo.', 100, 'repeating', 3, true)
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label,
      notes = EXCLUDED.notes,
      percent_off = EXCLUDED.percent_off,
      duration = EXCLUDED.duration,
      duration_in_months = EXCLUDED.duration_in_months,
      active = EXCLUDED.active,
      -- percent_off / duration change invalidates any minted Stripe coupon
      stripe_coupon_id_sandbox = NULL,
      stripe_promo_id_sandbox = NULL,
      stripe_coupon_id_live = NULL,
      stripe_promo_id_live = NULL;
