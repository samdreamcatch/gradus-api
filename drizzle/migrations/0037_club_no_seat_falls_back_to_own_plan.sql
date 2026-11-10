CREATE TABLE public.club_seat_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  coach_id uuid NOT NULL,
  coach_name text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE UNIQUE INDEX club_seat_requests_open ON public.club_seat_requests (organization_id, coach_id) WHERE resolved_at IS NULL;
GRANT SELECT ON public.club_seat_requests TO authenticated;
GRANT ALL ON public.club_seat_requests TO service_role;
ALTER TABLE public.club_seat_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Club admins read seat requests" ON public.club_seat_requests FOR SELECT TO authenticated
  USING (public.has_org_admin(auth.uid(), organization_id));

-- Free seat for this coach, honouring reservations (same rule as seat assignment).
CREATE FUNCTION public.club_open_seat_for(p_org uuid, p_user uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id FROM public.org_seats s
  LEFT JOIN public.org_coach_invites i ON i.id = s.reserved_invite_id
  WHERE s.organization_id = p_org AND (s.coach_id IS NULL OR s.released_at IS NOT NULL)
    AND (s.reserved_invite_id IS NULL OR i.status <> 'pending' OR i.expires_at <= now()
      OR i.id = nullif(current_setting('gradus.accepting_org_invite', true), '')::uuid
      OR lower(i.email) = lower((SELECT email FROM auth.users WHERE id = p_user)))
  ORDER BY (s.reserved_invite_id IS NOT NULL) DESC, s.seat_no LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.club_open_seat_for(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- No open seat: the coach keeps signing up on their own plan; the club is told.
CREATE FUNCTION public.club_seat_fallback(p_org uuid, p_coach uuid, p_name text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.club_seat_requests (organization_id, coach_id, coach_name)
  VALUES (p_org, p_coach, nullif(trim(p_name), ''))
  ON CONFLICT (organization_id, coach_id) WHERE resolved_at IS NULL DO NOTHING;
  INSERT INTO public.club_notifications (organization_id, kind, source_table, source_id, about, title, subject, coach, status, go_to)
  SELECT r.organization_id, 'no_seat', 'club_seat_requests', r.id, 'coaches', 'Coach joined without a seat',
    coalesce(r.coach_name, 'A coach'), NULL, 'needs_action', '/org-admin/people'
  FROM public.club_seat_requests r WHERE r.organization_id = p_org AND r.coach_id = p_coach AND r.resolved_at IS NULL
  ON CONFLICT (organization_id, kind, source_table, source_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.club_seat_fallback(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.precheck_coach_club_seat() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM id FROM public.organizations WHERE id = NEW.organization_id FOR UPDATE;
  IF public.club_open_seat_for(NEW.organization_id, NEW.user_id) IS NULL THEN
    PERFORM public.club_seat_fallback(NEW.organization_id, NEW.id, concat_ws(' ', NEW.first_name, NEW.last_name));
    NEW.organization_id := NULL;
    IF NEW.entitlement = 'club_covered' THEN NEW.entitlement := 'pending'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER coach_club_seat_precheck BEFORE INSERT ON public.coach_profiles FOR EACH ROW
  WHEN (NEW.organization_id IS NOT NULL) EXECUTE FUNCTION public.precheck_coach_club_seat();

CREATE OR REPLACE FUNCTION public.sync_coach_club_seat() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE selected_seat uuid; email_address text; accepting_invite uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN RETURN NEW; END IF;
  PERFORM id FROM public.organizations WHERE id IN (NEW.organization_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.organization_id ELSE NULL END) ORDER BY id FOR UPDATE;
  IF TG_OP = 'UPDATE' AND NEW.organization_id IS NOT NULL THEN
    IF public.club_open_seat_for(NEW.organization_id, NEW.user_id) IS NULL THEN
      PERFORM public.club_seat_fallback(NEW.organization_id, NEW.id, concat_ws(' ', NEW.first_name, NEW.last_name));
      NEW.organization_id := OLD.organization_id;
      IF NEW.entitlement = 'club_covered' AND OLD.entitlement IS DISTINCT FROM 'club_covered' THEN NEW.entitlement := OLD.entitlement; END IF;
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.organization_id IS NOT NULL THEN
    UPDATE public.org_seats SET released_at = now(), grace_until = now() + interval '90 days', reserved_invite_id = NULL
      WHERE coach_id = OLD.id AND organization_id = OLD.organization_id AND released_at IS NULL;
    IF NEW.organization_id IS NULL AND OLD.entitlement = 'club_covered' THEN
      NEW.entitlement := 'promo_free'; NEW.free_access_until := now() + interval '90 days';
    END IF;
  END IF;
  IF NEW.organization_id IS NOT NULL THEN
    UPDATE public.org_seats s SET reserved_invite_id = NULL WHERE s.organization_id = NEW.organization_id
      AND reserved_invite_id IN (SELECT id FROM public.org_coach_invites WHERE status <> 'pending' OR expires_at <= now());
    SELECT email INTO email_address FROM auth.users WHERE id = NEW.user_id;
    accepting_invite := nullif(current_setting('gradus.accepting_org_invite', true), '')::uuid;
    SELECT s.id INTO selected_seat FROM public.org_seats s
      LEFT JOIN public.org_coach_invites i ON i.id = s.reserved_invite_id
      WHERE s.organization_id = NEW.organization_id AND (s.coach_id IS NULL OR s.released_at IS NOT NULL)
        AND (s.reserved_invite_id IS NULL OR (i.status = 'pending' AND i.expires_at > now()
          AND (i.id = accepting_invite OR lower(i.email) = lower(email_address))))
      ORDER BY (s.reserved_invite_id IS NOT NULL) DESC, s.seat_no LIMIT 1 FOR UPDATE OF s;
    IF selected_seat IS NULL THEN RAISE EXCEPTION 'No coach seat is available in this club'; END IF;
    UPDATE public.org_seats SET coach_id = NEW.id, filled_at = now(), released_at = NULL, grace_until = NULL, reserved_invite_id = NULL WHERE id = selected_seat;
    UPDATE public.club_seat_requests SET resolved_at = now() WHERE coach_id = NEW.id AND organization_id = NEW.organization_id AND resolved_at IS NULL;
  END IF;
  RETURN NEW;
END $$;

-- Keep seat notices through the nightly refresh until the coach gets a seat.
CREATE OR REPLACE FUNCTION public.refresh_club_notifications(p_org_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    UNION ALL
    SELECT 'no_seat', 'club_seat_requests', q.id, 'coaches', 'Coach joined without a seat', coalesce(q.coach_name, 'A coach'), NULL, 'needs_action', q.requested_at, '/org-admin/people'
    FROM public.club_seat_requests q WHERE q.organization_id = p_org_id AND q.resolved_at IS NULL
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
REVOKE ALL ON FUNCTION public.refresh_club_notifications(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_club_notifications(uuid) TO service_role;