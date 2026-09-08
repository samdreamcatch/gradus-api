-- Close two TOCTOU races in withIdempotency() (src/lib/api/idempotency.ts),
-- flagged in review of the I11 invoicing wave:
--
-- 1. The replay lookup only compared (user_id, key); a stale/reused key with
--    a *different* body silently replayed the first response instead of
--    being rejected. Fixed by storing a `request_hash` alongside the
--    response and comparing it before replaying.
-- 2. The check-then-run-then-store sequence had no reservation row or
--    locking — `upsert(... onConflict: 'user_id,key')` just overwrote
--    whichever row existed, so two requests fired with the same key before
--    either completed both ran the handler (e.g. two invoices for the same
--    lesson). Fixed with a `reserve_idempotency_key` function that
--    serializes concurrent callers for the same (user_id, key) behind an
--    advisory lock and inserts a pending "reservation" row with no response
--    yet; a second caller arriving before the first completes sees
--    'in_progress' instead of also running the handler.
--
-- `response_status`/`response_body` become nullable to hold that pending
-- reservation state before the handler's result is recorded.
ALTER TABLE public.api_idempotency_keys
  ADD COLUMN IF NOT EXISTS request_hash text,
  ALTER COLUMN response_status DROP NOT NULL,
  ALTER COLUMN response_body DROP NOT NULL;

-- Reserves (user_id, key) for the caller, or reports why it can't:
--   'reserved'    — no live row (or the old one expired/was abandoned); the
--                   caller now owns it and should run the handler, then call
--                   complete_idempotency_key (or release_idempotency_key on
--                   failure).
--   'replay'      — a completed response for the same request_hash, within
--                   the replay window: return it verbatim, don't re-run.
--   'in_progress' — another call for this exact key is currently running
--                   the handler: caller should surface a 409, not run it.
--   'key_reused'  — a completed response exists for this key, but with a
--                   different request_hash: reject, don't replay it.
--
-- The advisory lock (keyed by user+key, released at transaction end) only
-- serializes the reservation decision itself — cheap and short — not the
-- handler run afterward, so it never holds a lock across a slow API call.
CREATE OR REPLACE FUNCTION public.reserve_idempotency_key(
  _user_id uuid,
  _key text,
  _request_hash text,
  _replay_window_seconds int,
  _pending_timeout_seconds int
)
RETURNS TABLE (state text, response_status int, response_body jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.api_idempotency_keys%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(_user_id::text || ':' || _key));

  SELECT * INTO _row FROM public.api_idempotency_keys
  WHERE user_id = _user_id AND key = _key;

  IF NOT FOUND THEN
    INSERT INTO public.api_idempotency_keys (user_id, key, request_hash, response_status, response_body, created_at)
    VALUES (_user_id, _key, _request_hash, NULL, NULL, now());
    RETURN QUERY SELECT 'reserved'::text, NULL::int, NULL::jsonb;
    RETURN;
  END IF;

  -- A completed response past the replay window, or a reservation whose
  -- handler never completed (crash/timeout): take it over as a fresh
  -- reservation rather than blocking on it forever.
  IF (_row.response_status IS NOT NULL
        AND _row.created_at < now() - make_interval(secs => _replay_window_seconds))
     OR (_row.response_status IS NULL
        AND _row.created_at < now() - make_interval(secs => _pending_timeout_seconds)) THEN
    UPDATE public.api_idempotency_keys
      SET request_hash = _request_hash, response_status = NULL, response_body = NULL, created_at = now()
      WHERE user_id = _user_id AND key = _key;
    RETURN QUERY SELECT 'reserved'::text, NULL::int, NULL::jsonb;
    RETURN;
  END IF;

  IF _row.response_status IS NULL THEN
    RETURN QUERY SELECT 'in_progress'::text, NULL::int, NULL::jsonb;
    RETURN;
  END IF;

  IF _row.request_hash IS DISTINCT FROM _request_hash THEN
    RETURN QUERY SELECT 'key_reused'::text, NULL::int, NULL::jsonb;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'replay'::text, _row.response_status, _row.response_body;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_idempotency_key(uuid, text, text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_idempotency_key(uuid, text, text, int, int) TO service_role;

-- Records the handler's result on a reservation this caller owns.
CREATE OR REPLACE FUNCTION public.complete_idempotency_key(
  _user_id uuid,
  _key text,
  _response_status int,
  _response_body jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.api_idempotency_keys
    SET response_status = _response_status, response_body = _response_body
    WHERE user_id = _user_id AND key = _key;
$$;

REVOKE ALL ON FUNCTION public.complete_idempotency_key(uuid, text, int, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_idempotency_key(uuid, text, int, jsonb) TO service_role;

-- Releases a reservation this caller owns when the handler failed, so a
-- retry with the same key isn't blocked for the rest of the replay window.
-- Only deletes it while it's still pending, so it can't clobber a response
-- another (later) reservation already completed.
CREATE OR REPLACE FUNCTION public.release_idempotency_key(_user_id uuid, _key text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.api_idempotency_keys
    WHERE user_id = _user_id AND key = _key AND response_status IS NULL;
$$;

REVOKE ALL ON FUNCTION public.release_idempotency_key(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_idempotency_key(uuid, text) TO service_role;