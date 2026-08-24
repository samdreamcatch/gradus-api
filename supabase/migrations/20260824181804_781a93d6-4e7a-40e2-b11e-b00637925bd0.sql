CREATE OR REPLACE FUNCTION public.can_subscribe_message_topic(_topic text, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _raw text;
  _id uuid;
BEGIN
  IF _topic IS NULL OR _user_id IS NULL THEN
    RETURN false;
  END IF;
  _raw := regexp_replace(_topic, '^(room|direct_room|direct):', '');
  BEGIN
    _id := _raw::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  RETURN public.is_room_participant(_id, _user_id)
      OR public.is_direct_room_participant(_id, _user_id);
END;
$$;

DROP POLICY IF EXISTS "Room participants can receive realtime" ON realtime.messages;

CREATE POLICY "Conversation participants can receive realtime"
ON realtime.messages
FOR SELECT
TO authenticated
USING (public.can_subscribe_message_topic(realtime.topic(), (SELECT auth.uid())));