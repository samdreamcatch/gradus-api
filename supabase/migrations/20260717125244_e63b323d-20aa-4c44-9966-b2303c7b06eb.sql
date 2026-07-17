
-- 1) direct_rooms table
CREATE TABLE public.direct_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('coach_coach','coach_parent')),
  user_a uuid NOT NULL,
  user_b uuid NOT NULL,
  coach_a_id uuid NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  coach_b_id uuid NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  coach_id uuid NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  parent_id uuid NULL REFERENCES public.parent_profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_a < user_b),
  CHECK (
    (kind = 'coach_coach' AND coach_a_id IS NOT NULL AND coach_b_id IS NOT NULL AND coach_id IS NULL AND parent_id IS NULL)
    OR
    (kind = 'coach_parent' AND coach_id IS NOT NULL AND parent_id IS NOT NULL AND coach_a_id IS NULL AND coach_b_id IS NULL)
  )
);

CREATE UNIQUE INDEX direct_rooms_pair_kind_idx ON public.direct_rooms(kind, user_a, user_b);
CREATE INDEX direct_rooms_user_a_idx ON public.direct_rooms(user_a);
CREATE INDEX direct_rooms_user_b_idx ON public.direct_rooms(user_b);

GRANT SELECT ON public.direct_rooms TO authenticated;
GRANT ALL ON public.direct_rooms TO service_role;

ALTER TABLE public.direct_rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants view direct rooms"
ON public.direct_rooms FOR SELECT
TO authenticated
USING (auth.uid() = user_a OR auth.uid() = user_b);

CREATE TRIGGER direct_rooms_set_updated_at
BEFORE UPDATE ON public.direct_rooms
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) is_direct_room_participant
CREATE OR REPLACE FUNCTION public.is_direct_room_participant(_direct_room_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.direct_rooms
    WHERE id = _direct_room_id
      AND (user_a = _user_id OR user_b = _user_id)
  )
$$;

-- 3) messages: add direct_room_id, make room_id nullable, enforce exactly one
ALTER TABLE public.messages ADD COLUMN direct_room_id uuid NULL REFERENCES public.direct_rooms(id) ON DELETE CASCADE;
ALTER TABLE public.messages ALTER COLUMN room_id DROP NOT NULL;
ALTER TABLE public.messages ADD CONSTRAINT messages_one_room_ck CHECK (
  (room_id IS NOT NULL AND direct_room_id IS NULL)
  OR
  (room_id IS NULL AND direct_room_id IS NOT NULL)
);
CREATE INDEX messages_direct_room_created_idx ON public.messages(direct_room_id, created_at);

-- 4) Update messages RLS policies to allow direct-room branch
DROP POLICY IF EXISTS "Participants insert messages" ON public.messages;
DROP POLICY IF EXISTS "Participants view messages" ON public.messages;

CREATE POLICY "Participants view messages"
ON public.messages FOR SELECT
TO authenticated
USING (
  (room_id IS NOT NULL AND public.is_room_participant(room_id, auth.uid()))
  OR
  (direct_room_id IS NOT NULL AND public.is_direct_room_participant(direct_room_id, auth.uid()))
);

CREATE POLICY "Participants insert messages"
ON public.messages FOR INSERT
TO authenticated
WITH CHECK (
  sender_user_id = auth.uid()
  AND (
    (room_id IS NOT NULL AND public.is_room_participant(room_id, auth.uid()))
    OR
    (direct_room_id IS NOT NULL AND public.is_direct_room_participant(direct_room_id, auth.uid()))
  )
);

-- 5) Update message_reads insert policy for direct rooms
DROP POLICY IF EXISTS "Users insert own reads" ON public.message_reads;

CREATE POLICY "Users insert own reads"
ON public.message_reads FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = message_reads.message_id
      AND (
        (m.room_id IS NOT NULL AND public.is_room_participant(m.room_id, auth.uid()))
        OR
        (m.direct_room_id IS NOT NULL AND public.is_direct_room_participant(m.direct_room_id, auth.uid()))
      )
  )
);

-- 6) validate_message_plan: no plan tagging in direct rooms
CREATE OR REPLACE FUNCTION public.validate_message_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _room record;
  _plan record;
BEGIN
  IF NEW.plan_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.direct_room_id IS NOT NULL THEN
    RAISE EXCEPTION 'Plans cannot be tagged in direct messages';
  END IF;
  SELECT coach_id, athlete_id INTO _room FROM message_rooms WHERE id = NEW.room_id;
  IF _room IS NULL THEN
    RAISE EXCEPTION 'Room not found';
  END IF;
  SELECT coach_id, athlete_id, kind, status INTO _plan FROM plans WHERE id = NEW.plan_id;
  IF _plan IS NULL THEN
    RAISE EXCEPTION 'Plan not found';
  END IF;
  IF _plan.coach_id <> _room.coach_id OR _plan.athlete_id <> _room.athlete_id THEN
    RAISE EXCEPTION 'Plan does not belong to this conversation';
  END IF;
  IF _plan.kind <> 'plan' THEN
    RAISE EXCEPTION 'Only plans can be tagged';
  END IF;
  RETURN NEW;
END;
$$;
