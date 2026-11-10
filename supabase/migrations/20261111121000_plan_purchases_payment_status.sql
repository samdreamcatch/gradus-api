-- Buy now, pay once the coach can be paid (src/lib/plan-purchases.server.ts).
-- A coach who hasn't finished Stripe Connect can still sell: the buyer gets
-- the plan right away without paying, and the purchase waits for the coach.
-- When the coach's payouts are on, it becomes due; the buyer completes payment
-- from the plan. Unpaid three days after it became due, the coach may restrict
-- the buyer (their copy of the plan is removed).
--
-- payment_status (whether the money came in), next to status (whether the
-- plan was delivered):
--   awaiting_coach_setup  delivered; the coach can't be paid yet, so nothing is owed yet
--   payment_due           the buyer owes it (payment_due_at: since when)
--   processing            a payment is being recorded
--   paid                  received (paid_at), coach's share transferred
--
-- Additive: new nullable columns on plan_purchases (from 20261111120800,
-- not on live yet) and a wider status check. Existing rows are labelled once:
-- delivered ones were paid at checkout, the rest were still at checkout.
ALTER TABLE public.plan_purchases
  ADD COLUMN IF NOT EXISTS payment_status text,
  ADD COLUMN IF NOT EXISTS payment_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS restricted_at timestamptz;

ALTER TABLE public.plan_purchases DROP CONSTRAINT IF EXISTS plan_purchases_payment_status_check;
ALTER TABLE public.plan_purchases
  ADD CONSTRAINT plan_purchases_payment_status_check CHECK (
    payment_status IS NULL
    OR payment_status IN ('awaiting_coach_setup', 'payment_due', 'processing', 'paid')
  );

-- status gains 'restricted': the coach removed an unpaid buyer's access.
ALTER TABLE public.plan_purchases DROP CONSTRAINT IF EXISTS plan_purchases_status_check;
ALTER TABLE public.plan_purchases
  ADD CONSTRAINT plan_purchases_status_check CHECK (
    status IN ('pending', 'fulfilling', 'fulfilled', 'canceled', 'restricted')
  );

UPDATE public.plan_purchases
SET payment_status = CASE WHEN status = 'fulfilled' THEN 'paid' ELSE 'payment_due' END
WHERE payment_status IS NULL;

CREATE INDEX IF NOT EXISTS plan_purchases_coach_payment_idx
  ON public.plan_purchases (coach_id, payment_status);

COMMENT ON COLUMN public.plan_purchases.payment_status IS
  'awaiting_coach_setup (coach not on Stripe yet, nothing owed yet) | payment_due (since payment_due_at) | processing | paid (paid_at).';
COMMENT ON COLUMN public.plan_purchases.payment_due_at IS
  'When payment became due: at checkout, or when the coach finished Stripe Connect. Unpaid 3 days after, the coach may restrict.';
COMMENT ON COLUMN public.plan_purchases.restricted_at IS
  'When the coach restricted an unpaid buyer (status restricted, their copy removed).';
