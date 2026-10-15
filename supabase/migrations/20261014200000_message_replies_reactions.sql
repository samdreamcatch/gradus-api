-- Replies and reactions in Messages (show-don't-tell redesign, 2026-10-14).
--
-- Replies: a message may quote one earlier message in the same conversation
-- (`reply_to_id`). The quoted message keeps living on its own; deleting it
-- leaves the reply without a quote.
--
-- Reactions: one per person per message, from a fixed set of five, and
-- swappable (Mariah, 2026-10-14). Clearing a reaction sets `emoji` to null
-- instead of deleting the row, so every change reaches realtime as an INSERT
-- or UPDATE, which Supabase filters by room and checks against RLS (DELETE
-- events are neither). `room_id` / `direct_room_id` copy the message's
-- container so a client can subscribe with the same `room_id=eq.<id>` filter
-- it uses for messages. No push and no unread for a reaction.
--
-- Writes go through the API (service role); signed-in users can only read
-- the reactions in conversations they belong to.

-- ---------- replies ----------
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES public.messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS messages_reply_to_idx ON public.messages (reply_to_id)
  WHERE reply_to_id IS NOT NULL;

-- A reply quotes a message from its own conversation, never another one.
CREATE OR REPLACE FUNCTION public.validate_message_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _target record;
BEGIN
  IF NEW.reply_to_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT room_id, direct_room_id INTO _target FROM messages WHERE id = NEW.reply_to_id;
  IF NOT FOUND
     OR _target.room_id IS DISTINCT FROM NEW.room_id
     OR _target.direct_room_id IS DISTINCT FROM NEW.direct_room_id THEN
    RAISE EXCEPTION 'reply_to_id must be a message in the same conversation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_message_reply ON public.messages;
CREATE TRIGGER trg_validate_message_reply
  BEFORE INSERT OR UPDATE OF reply_to_id ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.validate_message_reply();

-- ---------- reactions ----------
CREATE TABLE IF NOT EXISTS public.message_reactions (
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- a deleted account takes its reactions with it
  -- null = cleared (kept so realtime sees an UPDATE, see above)
  emoji text CHECK (emoji IN ('👍', '❤️', '😂', '🔥', '👏')),
  room_id uuid REFERENCES public.message_rooms(id) ON DELETE CASCADE,
  direct_room_id uuid REFERENCES public.direct_rooms(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id),
  CHECK ((room_id IS NOT NULL) <> (direct_room_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS message_reactions_room_idx ON public.message_reactions (room_id)
  WHERE room_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS message_reactions_direct_room_idx ON public.message_reactions (direct_room_id)
  WHERE direct_room_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS message_reactions_user_idx ON public.message_reactions (user_id);

GRANT SELECT ON public.message_reactions TO authenticated;
GRANT ALL ON public.message_reactions TO service_role;

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants view reactions" ON public.message_reactions;
CREATE POLICY "Participants view reactions"
ON public.message_reactions FOR SELECT
TO authenticated
USING (
  (room_id IS NOT NULL AND public.is_room_participant(room_id, auth.uid()))
  OR
  (direct_room_id IS NOT NULL AND public.is_direct_room_participant(direct_room_id, auth.uid()))
);

-- The container columns always match the message's, whoever writes the row.
CREATE OR REPLACE FUNCTION public.set_message_reaction_room()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  SELECT room_id, direct_room_id INTO NEW.room_id, NEW.direct_room_id
  FROM messages WHERE id = NEW.message_id;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_message_reaction_room ON public.message_reactions;
CREATE TRIGGER trg_set_message_reaction_room
  BEFORE INSERT OR UPDATE ON public.message_reactions
  FOR EACH ROW EXECUTE FUNCTION public.set_message_reaction_room();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'message_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
  END IF;
END $$;
