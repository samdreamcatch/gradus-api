-- The message check (PRD decision #64).
--
-- `message_flags`: one row per message the shared rule list
-- (src/lib/message-rules.ts) tripped, whether it was stopped, sent anyway, or
-- (self-harm, flag-only) sent normally. Listed in Admin › Reports and emailed
-- to support@gradussports.com. `body` is the text as typed, including text
-- that was never delivered; it is deleted when an admin dismisses the flag as
-- a false alarm, and otherwise kept seven years like a safety report (Privacy
-- Policy §7). No foreign keys to users, as on `user_reports`: the record
-- outlives the account.
--
-- `messaging_suspensions`: an admin can pause messaging for one user
-- (decision #64, §12 #42). `sendMessage` and `setReaction` refuse while a row
-- exists.
--
-- Both tables are server-only: RLS on, no policies and no grants to
-- `authenticated`. The admin pages read them through server functions that
-- check the admin role and use the service role.
CREATE TABLE IF NOT EXISTS public.message_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id uuid NOT NULL,
  sender_role text NOT NULL,
  sender_minor boolean NOT NULL DEFAULT false,
  room_id uuid,
  direct_room_id uuid,
  room_has_minor boolean NOT NULL DEFAULT false,
  coach_id uuid,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  body text,
  category text NOT NULL CHECK (category IN ('sexual','slur','threat','abuse','self_harm')),
  rule_id text NOT NULL,
  matched text NOT NULL DEFAULT '',
  outcome text NOT NULL CHECK (outcome IN ('stopped','sent_anyway','sent')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','actioned','dismissed')),
  admin_notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.message_flags IS
  'Messages the message check flagged (PRD #64). Server-only. body is deleted when a flag is dismissed as a false alarm.';

CREATE INDEX IF NOT EXISTS message_flags_status_idx
  ON public.message_flags (status, created_at DESC);
CREATE INDEX IF NOT EXISTS message_flags_sender_idx
  ON public.message_flags (sender_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS message_flags_coach_idx
  ON public.message_flags (coach_id, created_at DESC) WHERE coach_id IS NOT NULL;

ALTER TABLE public.message_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_flags FROM anon, authenticated;
GRANT ALL ON public.message_flags TO service_role;

DROP TRIGGER IF EXISTS update_message_flags_updated_at ON public.message_flags;
CREATE TRIGGER update_message_flags_updated_at
  BEFORE UPDATE ON public.message_flags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.messaging_suspensions (
  user_id uuid PRIMARY KEY,
  paused_by uuid NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.messaging_suspensions IS
  'Users whose messaging an admin has paused (PRD #64). Server-only. Delete the row to resume.';

ALTER TABLE public.messaging_suspensions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.messaging_suspensions FROM anon, authenticated;
GRANT ALL ON public.messaging_suspensions TO service_role;
