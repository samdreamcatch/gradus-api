-- Apple's RESCIND_CONSENT (PRD §6.13 B4, decision #33, milestone S3).
--
-- An App Store Server Notification V2 of type RESCIND_CONSENT says a parent
-- or guardian withdrew consent, through Apple, for a child's use of Gradus.
-- It names no Gradus account, only the `appTransactionId` of that child's
-- App Store download. The iOS app reports its own signed app transaction for
-- every athlete session (`POST /api/v1/me/app-transaction`); this table is
-- that binding, so `POST /api/public/webhooks/app-store` can pause every
-- athlete who used Gradus under the rescinded download.
--
-- Many-to-many on purpose: siblings can share a family iPad (one download,
-- two athletes), and an athlete can sign in on more than one device. The
-- environment is part of the key because sandbox (TestFlight) and production
-- downloads are separate id spaces. Coaches and parents are never bound.
--
-- `app_store_rescinded_transactions` remembers every rescinded download, so
-- an athlete who binds to it later (a first sign-in after the rescind, or an
-- account deleted and created again under the same Apple Account) is paused
-- at binding time. Restoring a paused athlete (an admin action, PRD §12 #29)
-- must delete the matching row here too, or the next binding pauses again.
--
-- Service-role only, like `webhook_receipts`: only the server reads or
-- writes them, after verifying Apple's signature. Bindings go with the athlete.

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
  -- The App Store notificationUUID that carried it (see webhook_receipts).
  notification_uuid text,
  PRIMARY KEY (app_transaction_id, environment)
);

ALTER TABLE public.app_store_rescinded_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_store_rescinded_transactions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.app_store_rescinded_transactions TO service_role;
