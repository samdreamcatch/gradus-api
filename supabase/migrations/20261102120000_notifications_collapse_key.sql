-- In-app inbox: replace on the push collapse id (follows 20261030120000_notifications).
--
-- Scheduled pushes (lesson reminders, wrap-up and recap prompts, practice
-- nudges) carry an `apns-collapse-id` and are re-sent on the next tick when
-- APNs failed transiently. Each re-send went through `notifyUsers`, so the
-- inbox gained a duplicate row per retry. Plan pushes (`plan:<id>`) and
-- acknowledgment asks (`ack:<resource>:<version>`) reuse their id on purpose:
-- on the phone the newer push replaces the older one.
--
-- `collapse_key` mirrors that in the inbox: an event with a collapse key
-- replaces the recipient's row with the same key (newest title/body/route,
-- unread again, moved to the top) instead of adding one. Events without one
-- keep the group-key fold, and events with neither add a row as before. A
-- push carries one or the other today; when both are given the collapse key
-- wins and the row is not folded.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS collapse_key text;

COMMENT ON COLUMN public.notifications.collapse_key IS
  'The push apns-collapse-id (e.g. plan:<id>). A new event with the same key replaces this row.';

-- One row per (recipient, collapse key), read or not; the replace target.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_collapse_key
  ON public.notifications (user_id, collapse_key)
  WHERE collapse_key IS NOT NULL;

-- The old signature is replaced, not overloaded, so callers can't reach the
-- version that ignores the collapse key.
DROP FUNCTION IF EXISTS public.record_notifications(uuid[], text, text, text, text, text, uuid, uuid);

CREATE OR REPLACE FUNCTION public.record_notifications(
  p_user_ids uuid[],
  p_type text,
  p_title text,
  p_body text DEFAULT NULL,
  p_route text DEFAULT NULL,
  p_group_key text DEFAULT NULL,
  p_actor_user_id uuid DEFAULT NULL,
  p_athlete_id uuid DEFAULT NULL,
  p_collapse_key text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_collapse_key IS NOT NULL THEN
    INSERT INTO public.notifications
      (user_id, type, title, body, route, collapse_key, actor_user_id, athlete_id)
    SELECT DISTINCT u, p_type, p_title, p_body, p_route, p_collapse_key, p_actor_user_id, p_athlete_id
    FROM unnest(p_user_ids) AS u
    ON CONFLICT (user_id, collapse_key) WHERE collapse_key IS NOT NULL
    DO UPDATE SET
      type = EXCLUDED.type,
      title = EXCLUDED.title,
      body = EXCLUDED.body,
      route = EXCLUDED.route,
      actor_user_id = EXCLUDED.actor_user_id,
      athlete_id = EXCLUDED.athlete_id,
      count = 1,
      read_at = NULL,
      created_at = now();
  ELSE
    INSERT INTO public.notifications
      (user_id, type, title, body, route, group_key, actor_user_id, athlete_id)
    SELECT DISTINCT u, p_type, p_title, p_body, p_route, p_group_key, p_actor_user_id, p_athlete_id
    FROM unnest(p_user_ids) AS u
    ON CONFLICT (user_id, group_key) WHERE read_at IS NULL AND group_key IS NOT NULL
    DO UPDATE SET
      count = public.notifications.count + 1,
      type = EXCLUDED.type,
      title = EXCLUDED.title,
      body = EXCLUDED.body,
      route = EXCLUDED.route,
      actor_user_id = EXCLUDED.actor_user_id,
      athlete_id = EXCLUDED.athlete_id,
      created_at = now();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_notifications(uuid[], text, text, text, text, text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_notifications(uuid[], text, text, text, text, text, uuid, uuid, text)
  TO service_role;
