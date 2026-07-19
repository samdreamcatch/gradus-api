CREATE TABLE public.billing_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_invoice_id TEXT,
  amount_cents INTEGER,
  currency TEXT,
  status TEXT,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  environment TEXT NOT NULL DEFAULT 'sandbox',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_billing_events_user_id ON public.billing_events(user_id);
CREATE INDEX idx_billing_events_subscription ON public.billing_events(stripe_subscription_id);
CREATE INDEX idx_billing_events_created ON public.billing_events(created_at DESC);

GRANT SELECT ON public.billing_events TO authenticated;
GRANT ALL ON public.billing_events TO service_role;

ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coaches view own billing events"
  ON public.billing_events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins view all billing events"
  ON public.billing_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Reclassify legacy test-user rows that were manually flipped to 'paid'
-- without any Stripe backing. Production rows are untouched.
UPDATE public.coach_profiles
SET entitlement = 'promo_free',
    promo_code  = COALESCE(promo_code, 'FOUNDING_COACH')
WHERE is_test = true
  AND entitlement = 'paid'
  AND stripe_customer_id IS NULL;
