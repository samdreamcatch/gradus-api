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
