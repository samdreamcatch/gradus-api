-- Restrict Realtime channel subscriptions to room participants only.
-- Topic must be the room UUID (as text); is_room_participant validates membership.
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Room participants can receive realtime" ON realtime.messages;

CREATE POLICY "Room participants can receive realtime"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  public.is_room_participant(
    (realtime.topic())::uuid,
    (SELECT auth.uid())
  )
);
