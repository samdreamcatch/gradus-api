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

-- API v1 fixed-window rate limiter.
--
-- Backs src/lib/api/rate-limit.ts: one row per (route, user-or-anon, ip)
-- bucket per time window, per docs/ios/PRD.md §6.2. Service-role-only:
-- written and read exclusively by the /api/v1 server layer through the
-- admin client — no end user or client ever queries this table directly.
CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  bucket text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0
);

GRANT ALL ON public.api_rate_limits TO service_role;

ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;
-- No policies for anon or authenticated: only the /api/v1 server layer
-- (service role) ever reads or writes rate-limit counters.

-- Auth broker identity linking, per docs/ios/PRD.md §6.4 (B2: auth broker).
--
-- Maps a third-party identity (Apple `sub`, Google `sub`) to the Supabase
-- auth user it signed in as, so a returning native sign-in finds the same
-- account instead of creating a duplicate. Service-role-only: written and
-- read exclusively by src/lib/api/auth-broker.ts through the admin client —
-- no end user or client ever queries this table directly.
CREATE TABLE IF NOT EXISTS public.auth_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('apple', 'google')),
  provider_sub text NOT NULL,
  email text,
  -- Apple's own refresh token from the authorization-code exchange (see
  -- POST /auth/apple), kept so the account-deletion flow can revoke Apple's
  -- grant to this app per PRD §6.4 ("the server must also revoke the Apple
  -- token"). Null until that exchange is wired up and the Apple key exists.
  apple_refresh_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_sub)
);

CREATE INDEX IF NOT EXISTS auth_identities_user_id_idx ON public.auth_identities (user_id);

GRANT ALL ON public.auth_identities TO service_role;

ALTER TABLE public.auth_identities ENABLE ROW LEVEL SECURITY;
-- No policies for anon or authenticated: only the /api/v1 auth broker
-- (service role) ever reads or writes identity links.

-- Looks up a CONFIRMED user by email for the auth broker's "match an
-- existing account" step (PRD §6.4: "else match a confirmed user by
-- email"). SECURITY DEFINER because `auth.users` isn't exposed to
-- PostgREST; returns only a uuid, never any other column, and is callable
-- by service_role alone.
CREATE OR REPLACE FUNCTION public.find_confirmed_user_by_email(_email text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM auth.users
  WHERE email = _email AND email_confirmed_at IS NOT NULL
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.find_confirmed_user_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_confirmed_user_by_email(text) TO service_role;