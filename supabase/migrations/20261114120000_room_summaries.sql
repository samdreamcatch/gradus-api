-- Conversations list: last message and unread count per room, in one query.
--
-- `listRooms` and `getUnreadTotal` (src/lib/messages.server.ts) used to read
-- every message in the caller's rooms, and every read receipt the caller has
-- ever written, on each call, and work both out in the Worker. That grew with
-- message history and ran into the API's row cap. This function does the same
-- work in the database and returns one row per room.
--
-- The caller passes the rooms it has already authorized (`listMyRoomIds`),
-- split the way `messages` stores them: `room_id` for athlete rooms,
-- `direct_room_id` for coach-coach and coach-parent rooms.
--
-- Rules, unchanged from the code this replaces:
--   * last message: the newest row in the room by `created_at`;
--   * unread: a message someone else sent (`sender_user_id` set and not the
--     caller) with no `message_reads` row for the caller. A deleted sender's
--     messages (`sender_user_id` null) never count.
--
-- Uses `messages_room_created_idx (room_id, created_at)`,
-- `messages_direct_room_created_idx (direct_room_id, created_at)` and the
-- `message_reads` primary key `(message_id, user_id)`.
--
-- SECURITY: the function takes a user id and room ids as arguments and does
-- no membership check of its own, so a signed-in user must never be able to
-- call it. It is SECURITY INVOKER and EXECUTE is granted to `service_role`
-- only; the server calls it through the service-role client after it has
-- worked out which rooms the caller belongs to. No new table, so no RLS
-- policy is needed.
CREATE OR REPLACE FUNCTION public.room_summaries(
  p_user_id uuid,
  p_athlete_room_ids uuid[],
  p_direct_room_ids uuid[]
)
RETURNS TABLE (
  room_key uuid,
  unread_count integer,
  id uuid,
  room_id uuid,
  direct_room_id uuid,
  sender_user_id uuid,
  sender_deleted_at timestamptz,
  sender_role text,
  kind text,
  body text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH athlete_rooms AS (
    SELECT DISTINCT unnest(COALESCE(p_athlete_room_ids, '{}'::uuid[])) AS room_key
  ),
  direct_rooms AS (
    SELECT DISTINCT unnest(COALESCE(p_direct_room_ids, '{}'::uuid[])) AS room_key
  ),
  -- Unread for all rooms at once, so the caller's read receipts are matched
  -- in one pass and not once per room.
  athlete_unread AS (
    SELECT m.room_id AS room_key, count(*) AS unread_count
    FROM public.messages m
    WHERE m.room_id = ANY (p_athlete_room_ids)
      AND m.sender_user_id IS NOT NULL
      AND m.sender_user_id <> p_user_id
      AND NOT EXISTS (
        SELECT 1 FROM public.message_reads mr
        WHERE mr.message_id = m.id AND mr.user_id = p_user_id
      )
    GROUP BY m.room_id
  ),
  direct_unread AS (
    SELECT m.direct_room_id AS room_key, count(*) AS unread_count
    FROM public.messages m
    WHERE m.direct_room_id = ANY (p_direct_room_ids)
      AND m.sender_user_id IS NOT NULL
      AND m.sender_user_id <> p_user_id
      AND NOT EXISTS (
        SELECT 1 FROM public.message_reads mr
        WHERE mr.message_id = m.id AND mr.user_id = p_user_id
      )
    GROUP BY m.direct_room_id
  )
  SELECT r.room_key,
         COALESCE(u.unread_count, 0)::integer,
         lm.id, lm.room_id, lm.direct_room_id, lm.sender_user_id,
         lm.sender_deleted_at, lm.sender_role, lm.kind, lm.body, lm.created_at
  FROM athlete_rooms r
  LEFT JOIN athlete_unread u ON u.room_key = r.room_key
  LEFT JOIN LATERAL (
    SELECT m.id, m.room_id, m.direct_room_id, m.sender_user_id,
           m.sender_deleted_at, m.sender_role, m.kind, m.body, m.created_at
    FROM public.messages m
    WHERE m.room_id = r.room_key
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
  ) lm ON true

  UNION ALL

  SELECT r.room_key,
         COALESCE(u.unread_count, 0)::integer,
         lm.id, lm.room_id, lm.direct_room_id, lm.sender_user_id,
         lm.sender_deleted_at, lm.sender_role, lm.kind, lm.body, lm.created_at
  FROM direct_rooms r
  LEFT JOIN direct_unread u ON u.room_key = r.room_key
  LEFT JOIN LATERAL (
    SELECT m.id, m.room_id, m.direct_room_id, m.sender_user_id,
           m.sender_deleted_at, m.sender_role, m.kind, m.body, m.created_at
    FROM public.messages m
    WHERE m.direct_room_id = r.room_key
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
  ) lm ON true;
$$;

COMMENT ON FUNCTION public.room_summaries(uuid, uuid[], uuid[]) IS
  'Last message and unread count per room for the conversations list. Service role only: it trusts its arguments, so the server authorizes the rooms first.';

REVOKE ALL ON FUNCTION public.room_summaries(uuid, uuid[], uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.room_summaries(uuid, uuid[], uuid[]) TO service_role;
