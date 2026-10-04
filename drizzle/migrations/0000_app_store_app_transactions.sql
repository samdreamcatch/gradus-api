CREATE TABLE IF NOT EXISTS public.app_store_app_transactions (
  app_transaction_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('Production', 'Sandbox')),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_transaction_id, environment, athlete_id)
);

CREATE INDEX IF NOT EXISTS app_store_app_transactions_athlete_idx
  ON public.app_store_app_transactions (athlete_id);

ALTER TABLE public.app_store_app_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_store_app_transactions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.app_store_app_transactions TO service_role;

CREATE TABLE IF NOT EXISTS public.app_store_rescinded_transactions (
  app_transaction_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('Production', 'Sandbox')),
  rescinded_at timestamptz NOT NULL DEFAULT now(),
  notification_uuid text,
  PRIMARY KEY (app_transaction_id, environment)
);

ALTER TABLE public.app_store_rescinded_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_store_rescinded_transactions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.app_store_rescinded_transactions TO service_role;