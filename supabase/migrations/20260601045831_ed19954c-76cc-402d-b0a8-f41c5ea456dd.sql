
-- ============================================================
-- Messages: 3-way rooms (coach ↔ athlete ↔ that athlete's parent)
-- ============================================================

-- ---------- message_rooms ----------
CREATE TABLE public.message_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL,
  athlete_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coach_id, athlete_id)
);

CREATE INDEX message_rooms_coach_idx ON public.message_rooms (coach_id);
CREATE INDEX message_rooms_athlete_idx ON public.message_rooms (athlete_id);

GRANT SELECT ON public.message_rooms TO authenticated;
GRANT ALL ON public.message_rooms TO service_role;

ALTER TABLE public.message_rooms ENABLE ROW LEVEL SECURITY;

-- ---------- messages ----------
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.message_rooms(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL,
  sender_role text NOT NULL CHECK (sender_role IN ('coach', 'athlete', 'parent')),
  kind text NOT NULL CHECK (kind IN ('text', 'voice')),
  body text NOT NULL DEFAULT '',
  audio_url text,
  duration_seconds integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX messages_room_created_idx ON public.messages (room_id, created_at);
CREATE INDEX messages_sender_idx ON public.messages (sender_user_id);

GRANT SELECT, INSERT ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- ---------- message_reads ----------
CREATE TABLE public.message_reads (
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX message_reads_user_idx ON public.message_reads (user_id);

GRANT SELECT, INSERT ON public.message_reads TO authenticated;
GRANT ALL ON public.message_reads TO service_role;

ALTER TABLE public.message_reads ENABLE ROW LEVEL SECURITY;

-- ---------- participant helper (security definer) ----------
CREATE OR REPLACE FUNCTION public.is_room_participant(_room_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM message_rooms r
    LEFT JOIN coach_profiles cp ON cp.id = r.coach_id
    LEFT JOIN athletes a ON a.id = r.athlete_id
    LEFT JOIN parent_profiles pp ON pp.id = a.parent_id
    WHERE r.id = _room_id
      AND (
        cp.user_id = _user_id
        OR a.user_id = _user_id
        OR pp.user_id = _user_id
      )
  );
$$;

-- ---------- RLS policies ----------

-- message_rooms: participants can see their rooms; inserts go through server fn (service_role)
CREATE POLICY "Participants view rooms"
ON public.message_rooms FOR SELECT
TO authenticated
USING (public.is_room_participant(id, auth.uid()));

-- messages: participants can read & post into rooms they belong to
CREATE POLICY "Participants view messages"
ON public.messages FOR SELECT
TO authenticated
USING (public.is_room_participant(room_id, auth.uid()));

CREATE POLICY "Participants insert messages"
ON public.messages FOR INSERT
TO authenticated
WITH CHECK (
  sender_user_id = auth.uid()
  AND public.is_room_participant(room_id, auth.uid())
);

-- message_reads: a user marks messages as read for themselves only,
-- and only for messages in rooms they participate in
CREATE POLICY "Users view own reads"
ON public.message_reads FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users insert own reads"
ON public.message_reads FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = message_id
      AND public.is_room_participant(m.room_id, auth.uid())
  )
);

-- ---------- updated_at trigger on rooms ----------
CREATE TRIGGER message_rooms_set_updated_at
BEFORE UPDATE ON public.message_rooms
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- Realtime ----------
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_rooms;
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.message_reads REPLICA IDENTITY FULL;
ALTER TABLE public.message_rooms REPLICA IDENTITY FULL;

-- ---------- Storage: private voice-notes bucket ----------
INSERT INTO storage.buckets (id, name, public)
VALUES ('voice-notes', 'voice-notes', false)
ON CONFLICT (id) DO NOTHING;

-- Path convention: {room_id}/{uuid}.webm
-- Participants of the room (folder = room_id) can read; uploads are server-only via service_role.

CREATE POLICY "Participants read voice notes"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'voice-notes'
  AND public.is_room_participant(
    ((storage.foldername(name))[1])::uuid,
    auth.uid()
  )
);
