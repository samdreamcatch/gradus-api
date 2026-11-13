-- Coach promo codes (src/lib/coach-promo-codes.server.ts): a coach makes
-- codes that buyers apply when buying one of the coach's marketplace plans
-- (src/lib/plan-purchases.server.ts).
--
-- Not the Gradus `promo_codes` table: that one is admin-made, platform-wide,
-- and discounts coach subscriptions through Stripe coupons. These belong to
-- one coach (the same code may exist for two coaches) and are applied on the
-- server: the purchase is charged the discounted amount directly.
--
-- discount_type percent: discount_value is 1–100 (% off the price).
-- discount_type fixed:   discount_value is USD off the price (never below 0).
-- 100% off (or a fixed discount covering the price) makes the plan free: it's
-- delivered with no checkout, and Gradus's 3% fee (on the amount paid) is 0.
--
-- plan_ids: NULL is every one of the coach's plans; otherwise only those.
-- max_redemptions / max_per_user: NULL is unlimited. Uses are counted from
-- plan_purchases (promo_code_id), not stored here, so they never drift.
--
-- Server-only: RLS on, no policies and no grants to `authenticated`. The API
-- uses the service role and checks the caller is the owning coach.
--
-- Additive and safe for the live app: one new table and new nullable
-- columns on plan_purchases (original_amount_cents backfilled from
-- amount_cents, then required).
CREATE TABLE IF NOT EXISTS public.coach_promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coach_profiles (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{3,32}$'),
  discount_type text NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value numeric(10, 2) NOT NULL CHECK (discount_value > 0),
  plan_ids uuid[] CHECK (plan_ids IS NULL OR cardinality(plan_ids) >= 1),
  max_redemptions integer CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  max_per_user integer DEFAULT 1 CHECK (max_per_user IS NULL OR max_per_user > 0),
  starts_at timestamptz,
  expires_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coach_promo_codes_percent_check
    CHECK (discount_type <> 'percent' OR discount_value <= 100),
  CONSTRAINT coach_promo_codes_window_check
    CHECK (starts_at IS NULL OR expires_at IS NULL OR expires_at > starts_at)
);

-- A code is unique per coach; buyers look it up by (coach, code).
CREATE UNIQUE INDEX IF NOT EXISTS coach_promo_codes_coach_code_key
  ON public.coach_promo_codes (coach_id, code);

ALTER TABLE public.coach_promo_codes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.coach_promo_codes TO service_role;

DROP TRIGGER IF EXISTS update_coach_promo_codes_updated_at ON public.coach_promo_codes;
CREATE TRIGGER update_coach_promo_codes_updated_at
  BEFORE UPDATE ON public.coach_promo_codes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.coach_promo_codes IS
  'Promo codes a coach makes for their marketplace plans. Server-only.';
COMMENT ON COLUMN public.coach_promo_codes.discount_value IS
  'percent: 1–100 (% off). fixed: USD off the price, never below 0.';
COMMENT ON COLUMN public.coach_promo_codes.plan_ids IS
  'The coach''s plans it applies to; NULL is all of them.';

-- ---------- What a purchase applied ----------
-- amount_cents stays what's charged (after the discount); the fee split and
-- Stripe Checkout already work from it.
ALTER TABLE public.plan_purchases
  ADD COLUMN IF NOT EXISTS promo_code_id uuid
    REFERENCES public.coach_promo_codes (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promo_code text,
  ADD COLUMN IF NOT EXISTS original_amount_cents integer
    CHECK (original_amount_cents >= 0);

UPDATE public.plan_purchases
SET original_amount_cents = amount_cents
WHERE original_amount_cents IS NULL;

ALTER TABLE public.plan_purchases ALTER COLUMN original_amount_cents SET NOT NULL;

CREATE INDEX IF NOT EXISTS plan_purchases_promo_code_idx
  ON public.plan_purchases (promo_code_id)
  WHERE promo_code_id IS NOT NULL;

COMMENT ON COLUMN public.plan_purchases.promo_code_id IS
  'The coach promo code applied; NULL when none (or the code was deleted since).';
COMMENT ON COLUMN public.plan_purchases.promo_code IS
  'The code as applied; kept if the coach renames or deletes it.';
COMMENT ON COLUMN public.plan_purchases.original_amount_cents IS
  'The plan''s price before any promo code; amount_cents is what was charged.';
