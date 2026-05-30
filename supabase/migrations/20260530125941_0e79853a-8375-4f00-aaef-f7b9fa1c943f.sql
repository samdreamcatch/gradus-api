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
  PERFORM pg_advisory_xact_lock(hashtext('invite_lookup:' || _ip));

  SELECT COUNT(*) INTO _count
  FROM invite_lookup_attempts
  WHERE ip = _ip
    AND attempted_at >= now() - make_interval(secs => _window_seconds);

  IF _count >= _max_per_window THEN
    RETURN -1;  -- sentinel: rate limit exceeded, no insert performed
  END IF;

  INSERT INTO invite_lookup_attempts (ip, code, found)
  VALUES (_ip, _code, false);

  RETURN _count + 1;
END;
$$;
