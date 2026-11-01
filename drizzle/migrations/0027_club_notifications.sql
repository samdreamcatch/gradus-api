CREATE TABLE public.club_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  kind text NOT NULL,
  source_table text NOT NULL,
  source_id uuid NOT NULL,
  about text NOT NULL CHECK (about IN ('athletes','coaches','library')),
  title text NOT NULL,
  subject text NOT NULL,
  coach text,
  status text NOT NULL CHECK (status IN ('needs_action','in_review','resolved')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution text,
  go_to text NOT NULL,
  UNIQUE (organization_id, kind, source_table, source_id)
);
GRANT SELECT ON public.club_notifications TO authenticated;
GRANT ALL ON public.club_notifications TO service_role;
ALTER TABLE public.club_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Club admins read notifications" ON public.club_notifications FOR SELECT TO authenticated USING (public.has_org_admin(auth.uid(), organization_id));

CREATE TABLE public.club_notification_reads (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  notification_id uuid NOT NULL REFERENCES public.club_notifications(id),
  user_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);
GRANT SELECT ON public.club_notification_reads TO authenticated;
GRANT ALL ON public.club_notification_reads TO service_role;
ALTER TABLE public.club_notification_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin reads own notification state" ON public.club_notification_reads FOR SELECT TO authenticated USING (user_id = auth.uid() AND public.has_org_admin(auth.uid(), organization_id));

CREATE TABLE public.club_safeguarding_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  notification_id uuid NOT NULL REFERENCES public.club_notifications(id),
  author_user_id uuid NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.club_safeguarding_notes TO authenticated;
GRANT SELECT, INSERT ON public.club_safeguarding_notes TO service_role;
ALTER TABLE public.club_safeguarding_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Club admins read evidence notes" ON public.club_safeguarding_notes FOR SELECT TO authenticated USING (public.has_org_admin(auth.uid(), organization_id));
CREATE FUNCTION public.guard_club_notification_reference() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.club_notifications WHERE id = NEW.notification_id AND organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'Notification does not belong to this club';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER club_note_scope BEFORE INSERT ON public.club_safeguarding_notes FOR EACH ROW EXECUTE FUNCTION public.guard_club_notification_reference();
CREATE TRIGGER club_read_scope BEFORE INSERT OR UPDATE ON public.club_notification_reads FOR EACH ROW EXECUTE FUNCTION public.guard_club_notification_reference();
CREATE FUNCTION public.guard_club_note_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Evidence notes are append-only'; END $$;
CREATE TRIGGER club_note_immutable BEFORE UPDATE OR DELETE ON public.club_safeguarding_notes FOR EACH ROW EXECUTE FUNCTION public.guard_club_note_immutable();

CREATE FUNCTION public.refresh_club_notifications(p_org_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM id FROM public.organizations WHERE id = p_org_id FOR UPDATE;
  WITH coaches AS (
    SELECT id, user_id, concat_ws(' ', first_name, last_name) AS name FROM public.coach_profiles WHERE organization_id = p_org_id
  ), linked AS (
    SELECT a.*, ca.coach_id, c.name AS coach_name, ca.messaging_paused_at FROM public.coach_athletes ca JOIN coaches c ON c.id = ca.coach_id JOIN public.athletes a ON a.id = ca.athlete_id
  ), members AS (
    SELECT user_id FROM coaches WHERE user_id IS NOT NULL
    UNION SELECT user_id FROM linked WHERE user_id IS NOT NULL
    UNION SELECT p.user_id FROM public.parent_profiles p JOIN linked l ON l.parent_id = p.id WHERE p.user_id IS NOT NULL
    UNION SELECT p.user_id FROM public.athlete_guardians g JOIN linked l ON l.id = g.athlete_id JOIN public.parent_profiles p ON p.id = g.parent_id WHERE p.user_id IS NOT NULL
  ), sources AS (
    SELECT DISTINCT ON (id) 'parent_not_joined'::text AS kind, 'athletes'::text AS source_table, id AS source_id, 'athletes'::text AS about,
      'Parent has not joined'::text AS title, concat_ws(' ', first_name, last_name) AS subject, coach_name AS coach, 'needs_action'::text AS status,
      coalesce(guardian_invited_at, created_at) AS opened_at, '/org-admin/notifications'::text AS go_to
    FROM linked WHERE birthdate > (current_date - interval '18 years')::date AND guardian_claimed_at IS NULL AND parent_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.athlete_guardians g WHERE g.athlete_id = linked.id)
    ORDER BY id, coach_id
  ), other_sources AS (
    SELECT 'paused_messaging', 'coach_athletes', ca.id, 'athletes', 'Parent paused messaging', concat_ws(' ', a.first_name, a.last_name), c.name, 'needs_action', ca.messaging_paused_at, '/org-admin/notifications'
    FROM public.coach_athletes ca JOIN coaches c ON c.id = ca.coach_id JOIN public.athletes a ON a.id = ca.athlete_id WHERE ca.messaging_paused_at IS NOT NULL
    UNION ALL
    SELECT 'held_resource', 'resources', r.id, 'library', 'Club document held for review', r.title, NULL, 'in_review', r.created_at, '/org-admin/resources'
    FROM public.resources r WHERE r.organization_id = p_org_id AND r.review_state = 'held'
    UNION ALL
    SELECT 'report', 'user_reports', r.id, 'athletes', 'Report filed', 'Restricted report', NULL, CASE WHEN r.status IN ('resolved','dismissed') THEN 'resolved' ELSE 'in_review' END, r.created_at, '/org-admin/notifications'
    FROM public.user_reports r WHERE r.reported_user_id IN (SELECT user_id FROM members) OR r.resource_id IN (SELECT id FROM public.resources WHERE organization_id = p_org_id)
    UNION ALL
    SELECT 'block', 'user_blocks', b.id, 'athletes', 'Communication blocked', 'Restricted account status', NULL, 'needs_action', b.created_at, '/org-admin/notifications'
    FROM public.user_blocks b WHERE b.blocker_user_id IN (SELECT user_id FROM members) AND b.blocked_user_id IN (SELECT user_id FROM members)
    UNION ALL
    SELECT 'coach_invite', 'org_coach_invites', i.id, 'coaches', CASE WHEN i.expires_at <= now() THEN 'Coach invite expired' ELSE 'Coach invite unanswered' END, coalesce(i.email, 'Invited coach'), NULL, 'needs_action', i.created_at, '/org-admin/roster'
    FROM public.org_coach_invites i WHERE i.organization_id = p_org_id AND i.status = 'pending'
  ), all_sources AS (SELECT * FROM sources UNION ALL SELECT * FROM other_sources), upserted AS (
    INSERT INTO public.club_notifications (organization_id, kind, source_table, source_id, about, title, subject, coach, status, opened_at, go_to, resolved_at, resolution)
    SELECT p_org_id, kind, source_table, source_id, about, title, subject, coach, status, opened_at, go_to,
      CASE WHEN status = 'resolved' THEN now() ELSE NULL END, CASE WHEN status = 'resolved' THEN 'Source marked resolved' ELSE NULL END FROM all_sources
    ON CONFLICT (organization_id, kind, source_table, source_id) DO UPDATE SET title = EXCLUDED.title, subject = EXCLUDED.subject, coach = EXCLUDED.coach, status = EXCLUDED.status,
      resolved_at = CASE WHEN EXCLUDED.status = 'resolved' THEN coalesce(club_notifications.resolved_at, now()) ELSE NULL END,
      resolution = EXCLUDED.resolution
    RETURNING id
  )
  UPDATE public.club_notifications SET status = 'resolved', resolved_at = now(), resolution = 'Source condition cleared'
  WHERE organization_id = p_org_id AND status <> 'resolved' AND id NOT IN (SELECT id FROM upserted);
END $$;
REVOKE ALL ON FUNCTION public.refresh_club_notifications(uuid), public.guard_club_notification_reference(), public.guard_club_note_immutable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_club_notifications(uuid) TO service_role;
