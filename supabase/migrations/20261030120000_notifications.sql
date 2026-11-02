-- In-app notification inbox for the apps (gradus-ios Notifications screen).
--
-- Until now the iOS screen listed only what Notification Center still held
-- (UNUserNotificationCenter.deliveredNotifications), so it was empty with push
-- off, after a swipe-clear, on a new device or after a reinstall, and read
-- state never synced. This table keeps one row per recipient for every alert
-- push `notifyUsers` sends (src/lib/push-notify.server.ts); silent pushes
-- (`entitlement`) are not stored.
--
-- Folding: an event with a `group_key` (the push `threadId`, e.g.
-- `room:<id>`) bumps the recipient's unread row for that key instead of adding
-- a new one, so a busy room is one "3 new messages" row, not thirty. Once the
-- row is read, the next event starts a fresh row. `record_notifications` does
-- this atomically against the partial unique index below.
--
-- Writes: the server only (service role, via `record_notifications`); there
-- is no INSERT grant or policy. Reads, mark-read and clear: the owner, through
-- RLS, served by the /api/v1/notifications routes.
--
-- Retention: rows older than 90 days are purged nightly (pg_cron below). Rows
-- about an athlete go with the athlete (ON DELETE CASCADE), and every row goes
-- with its recipient's account.
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  route text,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  athlete_id uuid REFERENCES public.athletes(id) ON DELETE CASCADE,
  group_key text,
  count integer NOT NULL DEFAULT 1 CHECK (count >= 1),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notifications IS
  'In-app notification inbox: one row per recipient per alert push (src/lib/push-notify.server.ts). Written by the server only.';
COMMENT ON COLUMN public.notifications.type IS
  'The push `gradus.type`: message, plan_assigned, lesson_reminder, lesson_wrap_up, practice_nudge, competition_recap, connection, resource_ack, consent_rescinded.';
COMMENT ON COLUMN public.notifications.route IS
  'The push `gradus.route` (rooms/<id>, plans/<id>, …), parsed by the apps'' RouteParser.';
COMMENT ON COLUMN public.notifications.group_key IS
  'The push threadId (e.g. room:<id>). New events fold into the unread row with the same key.';
COMMENT ON COLUMN public.notifications.count IS
  'Events folded into this row; 1 for an unfolded notification.';

-- The inbox list, newest first, paged on (created_at, id).
CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC, id DESC);

-- Badge count.
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_id)
  WHERE read_at IS NULL;

-- At most one unread row per (recipient, group); the fold target.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_group_unread_key
  ON public.notifications (user_id, group_key)
  WHERE read_at IS NULL AND group_key IS NOT NULL;

-- Retention sweep and the athlete cascade.
CREATE INDEX IF NOT EXISTS notifications_created_idx
  ON public.notifications (created_at);
CREATE INDEX IF NOT EXISTS notifications_athlete_idx
  ON public.notifications (athlete_id)
  WHERE athlete_id IS NOT NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

DROP POLICY IF EXISTS "Own notifications: read" ON public.notifications;
CREATE POLICY "Own notifications: read" ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Own notifications: mark read" ON public.notifications;
CREATE POLICY "Own notifications: mark read" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Own notifications: clear" ON public.notifications;
CREATE POLICY "Own notifications: clear" ON public.notifications
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- One event for many recipients. Without a group key every recipient gets a
-- new row; with one, a recipient's unread row for that key absorbs the event
-- (count + 1, newest title/body/route/actor, moved to the top).
CREATE OR REPLACE FUNCTION public.record_notifications(
  p_user_ids uuid[],
  p_type text,
  p_title text,
  p_body text DEFAULT NULL,
  p_route text DEFAULT NULL,
  p_group_key text DEFAULT NULL,
  p_actor_user_id uuid DEFAULT NULL,
  p_athlete_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.record_notifications(uuid[], text, text, text, text, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_notifications(uuid[], text, text, text, text, text, uuid, uuid)
  TO service_role;

-- Nightly purge of rows older than 90 days.
DO $$ BEGIN
  PERFORM cron.unschedule('notifications-purge-nightly');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'notifications-purge-nightly',
  '17 4 * * *',
  $$ DELETE FROM public.notifications WHERE created_at < now() - interval '90 days'; $$
);
