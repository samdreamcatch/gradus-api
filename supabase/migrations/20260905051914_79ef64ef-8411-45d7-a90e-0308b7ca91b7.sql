-- API v1 idempotency store.
--
-- Creating POSTs under /api/v1 (messages, sessions, invoices, lesson-slots,
-- plans) accept an Idempotency-Key header; the server stores the first
-- response here keyed by (user_id, key) and replays it on retry for 24h,
-- per docs/ios/PRD.md §6.2. Service-role-only: written and read exclusively
-- by src/lib/api/idempotency.ts through the admin client — no end user or
-- client ever queries this table directly.
CREATE TABLE IF NOT EXISTS public.api_idempotency_keys (
  user_id uuid NOT NULL,
  key text NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS api_idempotency_keys_created_at_idx
  ON public.api_idempotency_keys (created_at);

GRANT ALL ON public.api_idempotency_keys TO service_role;

ALTER TABLE public.api_idempotency_keys ENABLE ROW LEVEL SECURITY;
-- No policies for anon or authenticated: only the /api/v1 server layer
-- (service role) ever reads or writes idempotency records.

-- Hourly cleanup of replay records older than 24h, matching the existing
-- pg_cron pattern already used in this project (see
-- 20260819195309_dbceaed4-01cc-4d04-9f03-c6d8a98de028.sql). Pure SQL, no
-- net.http_post call, so no secret or webhook URL is needed here.
SELECT cron.schedule(
  'api-idempotency-cleanup-hourly',
  '0 * * * *',
  $$
  DELETE FROM public.api_idempotency_keys WHERE created_at < now() - interval '24 hours';
  $$
);
