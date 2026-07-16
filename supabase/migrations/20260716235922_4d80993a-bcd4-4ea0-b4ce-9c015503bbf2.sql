
-- Phase 2: promo code discounts + attribution through invites.

-- 1) Extend promo_codes with discount value and per-env Stripe IDs.
ALTER TABLE public.promo_codes
  ADD COLUMN percent_off integer NOT NULL DEFAULT 0
    CHECK (percent_off BETWEEN 0 AND 100),
  ADD COLUMN stripe_coupon_id_sandbox text,
  ADD COLUMN stripe_promo_id_sandbox  text,
  ADD COLUMN stripe_coupon_id_live    text,
  ADD COLUMN stripe_promo_id_live     text;

-- 2) Let invite codes carry the inviter's promo code so it propagates to the
--    coach who eventually pays. Coach invite codes don't need this — the
--    coach is already the payer.
ALTER TABLE public.athlete_invite_codes
  ADD COLUMN promo_code text
    REFERENCES public.promo_codes(code) ON DELETE SET NULL;

ALTER TABLE public.parent_invite_codes
  ADD COLUMN promo_code text
    REFERENCES public.promo_codes(code) ON DELETE SET NULL;

ALTER TABLE public.adult_athlete_invite_codes
  ADD COLUMN promo_code text
    REFERENCES public.promo_codes(code) ON DELETE SET NULL;
