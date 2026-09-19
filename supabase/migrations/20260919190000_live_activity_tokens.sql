-- Live Activity push tokens and sessions (PRD §6.6 "Live Activities",
-- §6.9 "Live Activity"; pre-QA gate P3).
--
-- `live_activity_tokens`: what the iOS app uploads through
-- POST /api/v1/live-activities/tokens — a per-device push-to-start token
-- (`board_start`, lets the server start a Live Board activity while the app
-- is closed) and, once an activity exists, its per-activity update token
-- (`board_update`, keyed by the activity's `activity_key`
-- "<slug>|<event file>|<normalized skater name>"). Same access model as
-- `device_tokens`: users manage their own rows, the server reads them all.
CREATE TABLE IF NOT EXISTS public.live_activity_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('board_start', 'board_update')),
  activity_key text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A push-to-start token is per device (no key); an update token is per activity (key required).
  CHECK ((kind = 'board_start') = (activity_key IS NULL))
);

CREATE INDEX IF NOT EXISTS live_activity_tokens_user_id_idx ON public.live_activity_tokens (user_id);
-- One user can hold the same activity on several devices, each with its own
-- update token, so (user_id, activity_key) is indexed, not unique.
CREATE INDEX IF NOT EXISTS live_activity_tokens_user_key_idx
  ON public.live_activity_tokens (user_id, activity_key) WHERE kind = 'board_update';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_activity_tokens TO authenticated;
GRANT ALL ON public.live_activity_tokens TO service_role;

ALTER TABLE public.live_activity_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own live activity tokens"
  ON public.live_activity_tokens FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- `live_activity_sessions`: the server's memory of which activities it has
-- started or updated for a follower, with the last content state it pushed,
-- so a 30-second board refresh only pushes real changes and never starts the
-- same activity twice (src/lib/live-activities.server.ts). Service-role only.
CREATE TABLE IF NOT EXISTS public.live_activity_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  competition_slug text NOT NULL,
  activity_key text NOT NULL,
  last_state text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  UNIQUE (user_id, activity_key)
);

CREATE INDEX IF NOT EXISTS live_activity_sessions_slug_idx
  ON public.live_activity_sessions (competition_slug, user_id);

GRANT ALL ON public.live_activity_sessions TO service_role;

ALTER TABLE public.live_activity_sessions ENABLE ROW LEVEL SECURITY;
-- No policies for anon or authenticated: server bookkeeping only.
