-- Marketplace plan purchases (src/lib/plan-purchases.server.ts), paid by
-- Stripe Checkout on the platform account (Gradus is the seller of record).
-- Once paid, Gradus keeps a 3% platform fee, Stripe's processing fee comes out
-- of the coach's share, and the rest is transferred to the coach's Connect
-- account; the buyer's athlete gets their own copy of the plan
-- (source = 'athlete', like an athlete-authored plan).
--
-- A new table: nothing existing changes, so the live app is unaffected.
-- Rows are server-written only (no INSERT/UPDATE/DELETE policies); buyers
-- read their own purchases and coaches read their sales.
CREATE TABLE IF NOT EXISTS public.plan_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The listing bought; kept as history if the coach deletes it later.
  plan_id uuid REFERENCES public.plans (id) ON DELETE SET NULL,
  coach_id uuid REFERENCES public.coach_profiles (id) ON DELETE SET NULL,
  buyer_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  -- Who the plan is for: the buyer themselves (an athlete) or a parent's child.
  athlete_id uuid REFERENCES public.athletes (id) ON DELETE SET NULL,
  -- The athlete's own copy, made once the payment clears.
  copied_plan_id uuid REFERENCES public.plans (id) ON DELETE SET NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'usd',
  platform_fee_cents integer CHECK (platform_fee_cents >= 0),
  stripe_fee_cents integer CHECK (stripe_fee_cents >= 0),
  coach_payout_cents integer CHECK (coach_payout_cents >= 0),
  -- pending: checkout opened; fulfilling: paid, being delivered;
  -- fulfilled: paid, coach paid, plan copied; canceled: checkout abandoned.
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'fulfilling', 'fulfilled', 'canceled')),
  stripe_checkout_session_id text UNIQUE,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  stripe_transfer_id text,
  failure_reason text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One completed purchase of a listing per athlete.
CREATE UNIQUE INDEX IF NOT EXISTS plan_purchases_one_per_athlete
  ON public.plan_purchases (plan_id, athlete_id)
  WHERE status = 'fulfilled';
CREATE INDEX IF NOT EXISTS plan_purchases_buyer_idx ON public.plan_purchases (buyer_user_id);
CREATE INDEX IF NOT EXISTS plan_purchases_coach_idx ON public.plan_purchases (coach_id);

ALTER TABLE public.plan_purchases ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.plan_purchases TO authenticated;
GRANT ALL ON public.plan_purchases TO service_role;

DROP POLICY IF EXISTS "Buyers read their purchases" ON public.plan_purchases;
CREATE POLICY "Buyers read their purchases"
ON public.plan_purchases FOR SELECT
TO authenticated
USING (buyer_user_id = auth.uid());

DROP POLICY IF EXISTS "Coaches read their sales" ON public.plan_purchases;
CREATE POLICY "Coaches read their sales"
ON public.plan_purchases FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.coach_profiles cp
    WHERE cp.id = plan_purchases.coach_id AND cp.user_id = auth.uid()
  )
);

COMMENT ON TABLE public.plan_purchases IS
  'Marketplace plan purchases (Stripe Checkout). Server-written only; buyers read theirs, coaches read their sales.';
