-- Mark a conversation read in one statement.
--
-- `markRoomRead` (src/lib/messages.server.ts) used to read the id of every
-- message other people sent in the room, read back which of those the caller
-- had already read (every id in the request URL), and insert the rest. All
-- three steps grew with the room's history. The first was cut off by the
-- API's row limit, so a long room could keep messages that never got marked;
-- the second could outgrow the URL, after which the insert failed on the
-- rows that were already there.
--
-- This does the same thing in the database: a read receipt for every message
-- in the room that someone else sent and the caller has not read. Returns how
-- many were marked. `p_direct` says which column holds the room: false for an
-- athlete room (`messages.room_id`), true for a coach-coach or coach-parent
-- room (`messages.direct_room_id`).
--
-- SECURITY: the function trusts its arguments and does no membership check,
-- so a signed-in user must never be able to call it. SECURITY INVOKER, and
-- EXECUTE for `service_role` only; the server calls it through the
-- service-role client after it has checked the caller belongs to the room
-- (`listMyRoomIds`). No new table, so no RLS policy is needed.
CREATE OR REPLACE FUNCTION public.mark_room_read(
  p_user_id uuid,
  p_room_id uuid,
  p_direct boolean
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  marked integer;
BEGIN
  IF p_direct THEN
    INSERT INTO public.message_reads (message_id, user_id)
    SELECT m.id, p_user_id
    FROM public.messages m
    WHERE m.direct_room_id = p_room_id
      AND m.sender_user_id IS NOT NULL
      AND m.sender_user_id <> p_user_id
      AND NOT EXISTS (
        SELECT 1 FROM public.message_reads mr
        WHERE mr.message_id = m.id AND mr.user_id = p_user_id
      )
    ON CONFLICT (message_id, user_id) DO NOTHING;
  ELSE
    INSERT INTO public.message_reads (message_id, user_id)
    SELECT m.id, p_user_id
    FROM public.messages m
    WHERE m.room_id = p_room_id
      AND m.sender_user_id IS NOT NULL
      AND m.sender_user_id <> p_user_id
      AND NOT EXISTS (
        SELECT 1 FROM public.message_reads mr
        WHERE mr.message_id = m.id AND mr.user_id = p_user_id
      )
    ON CONFLICT (message_id, user_id) DO NOTHING;
  END IF;
  GET DIAGNOSTICS marked = ROW_COUNT;
  RETURN marked;
END;
$$;

COMMENT ON FUNCTION public.mark_room_read(uuid, uuid, boolean) IS
  'Marks every unread message from other people in one room read for one user. Service role only: it trusts its arguments, so the server authorizes the room first.';

REVOKE ALL ON FUNCTION public.mark_room_read(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_room_read(uuid, uuid, boolean) TO service_role;