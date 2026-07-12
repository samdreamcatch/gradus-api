-- 1. last_seen_at on coach_profiles and parent_profiles
ALTER TABLE public.coach_profiles ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE public.parent_profiles ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS coach_profiles_last_seen_at_idx ON public.coach_profiles (last_seen_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS parent_profiles_last_seen_at_idx ON public.parent_profiles (last_seen_at DESC NULLS LAST);

-- RPC: touch last_seen_at for the calling user across whichever profile row(s) exist.
-- SECURITY DEFINER so a user can bump their own last_seen_at without needing
-- broader UPDATE policies. Scoped to auth.uid() so it can't be abused.
CREATE OR REPLACE FUNCTION public.touch_last_seen()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.coach_profiles SET last_seen_at = now() WHERE user_id = _uid;
  UPDATE public.parent_profiles SET last_seen_at = now() WHERE user_id = _uid;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_last_seen() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.touch_last_seen() TO authenticated;

-- 2. Cached AI explanations for error groups (keyed by normalized signature)
CREATE TABLE IF NOT EXISTS public.error_group_explanations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signature text NOT NULL UNIQUE,
  sample_message text NOT NULL,
  explanation text NOT NULL,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.error_group_explanations TO service_role;

ALTER TABLE public.error_group_explanations ENABLE ROW LEVEL SECURITY;
-- No policies: access is admin-only via the service-role client in server functions.
