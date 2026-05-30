-- Atomic per-IP rate-limit helper for invite-code lookups.
-- Uses a transaction-scoped advisory lock keyed by IP so concurrent
-- requests from the same IP serialize through the count+insert,
-- eliminating the TOCTOU race in the previous check-then-insert.
CREATE OR REPLACE FUNCTION public.record_invite_lookup_attempt(
  _ip text,
  _code text,
  _max_per_window int,
  _window_seconds int
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count int;
BEGIN
  -- Serialize concurrent attempts from the same IP within this transaction.
  PERFORM pg_advisory_xact_lock(hashtext('invite_lookup:' || _ip));

  SELECT COUNT(*) INTO _count
  FROM invite_lookup_attempts
  WHERE ip = _ip
    AND attempted_at >= now() - make_interval(secs => _window_seconds);

  IF _count >= _max_per_window THEN
    RETURN _count;  -- caller checks and rejects
  END IF;

  INSERT INTO invite_lookup_attempts (ip, code, found)
  VALUES (_ip, _code, false);

  RETURN _count + 1;
END;
$$;

-- Lock down EXECUTE: only the service role (used by server-side admin client) may call this.
REVOKE ALL ON FUNCTION public.record_invite_lookup_attempt(text, text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_invite_lookup_attempt(text, text, int, int) TO service_role;
