-- Stage 1: explicit club capacity, independent admins, and read-only contract.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS coach_seats integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS admin_seats integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS storefront_share_bps integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS storefront_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contract_starts_on date,
  ADD COLUMN IF NOT EXISTS contract_ends_on date,
  ADD COLUMN IF NOT EXISTS contract_signed_on date,
  ADD COLUMN IF NOT EXISTS contract_file_url text;
GRANT SELECT (coach_seats, admin_seats, storefront_share_bps, storefront_enabled,
  contract_starts_on, contract_ends_on, contract_signed_on, contract_file_url)
  ON public.organizations TO authenticated;

ALTER TABLE public.org_admins
  ADD COLUMN IF NOT EXISTS club_role text NOT NULL DEFAULT 'admin',
  ADD COLUMN IF NOT EXISTS club_title text;
ALTER TABLE public.org_admins ADD CONSTRAINT org_admins_club_role_check CHECK (club_role IN ('owner', 'admin'));
-- Existing admins retain their roles; Gradus staff must explicitly designate owners.
UPDATE public.organizations o SET
  coach_seats = greatest(o.coach_seats,
    (SELECT count(*) FROM public.coach_profiles c WHERE c.organization_id = o.id)
    + (SELECT count(*) FROM public.org_coach_invites i WHERE i.organization_id = o.id AND i.status = 'pending' AND i.expires_at > now())),
  admin_seats = greatest(o.admin_seats, (SELECT count(*) FROM public.org_admins a WHERE a.organization_id = o.id));

CREATE TABLE public.org_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  seat_no integer NOT NULL CHECK (seat_no > 0),
  coach_id uuid REFERENCES public.coach_profiles(id),
  reserved_invite_id uuid REFERENCES public.org_coach_invites(id),
  filled_at timestamptz,
  released_at timestamptz,
  grace_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, seat_no)
);
GRANT SELECT ON public.org_seats TO authenticated;
GRANT ALL ON public.org_seats TO service_role;
ALTER TABLE public.org_seats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Club admins read seats" ON public.org_seats FOR SELECT TO authenticated
  USING (public.has_org_admin(auth.uid(), organization_id));
CREATE POLICY "Coaches read own seat" ON public.org_seats FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.coach_profiles c WHERE c.id = coach_id AND c.user_id = auth.uid()));
CREATE UNIQUE INDEX org_seats_active_coach ON public.org_seats (coach_id) WHERE coach_id IS NOT NULL AND released_at IS NULL;
CREATE UNIQUE INDEX org_seats_reserved_invite ON public.org_seats (reserved_invite_id) WHERE reserved_invite_id IS NOT NULL;

INSERT INTO public.org_seats (organization_id, seat_no)
SELECT o.id, n FROM public.organizations o CROSS JOIN LATERAL generate_series(1, o.coach_seats) n;
WITH coaches AS (
  SELECT id, organization_id, created_at, row_number() OVER (PARTITION BY organization_id ORDER BY created_at, id) AS seat_no
  FROM public.coach_profiles WHERE organization_id IS NOT NULL
)
UPDATE public.org_seats s SET coach_id = c.id, filled_at = c.created_at
FROM coaches c WHERE s.organization_id = c.organization_id AND s.seat_no = c.seat_no;
WITH invites AS (
  SELECT i.id, i.organization_id, row_number() OVER (PARTITION BY i.organization_id ORDER BY i.created_at, i.id) AS n
  FROM public.org_coach_invites i WHERE i.status = 'pending' AND i.expires_at > now()
), available AS (
  SELECT id, organization_id, row_number() OVER (PARTITION BY organization_id ORDER BY seat_no) AS n
  FROM public.org_seats WHERE coach_id IS NULL
)
UPDATE public.org_seats s SET reserved_invite_id = i.id FROM invites i JOIN available a
  ON a.organization_id = i.organization_id AND a.n = i.n WHERE s.id = a.id;

CREATE FUNCTION public.sync_club_seat_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE used integer; admins integer;
BEGIN
  IF NEW.coach_seats < 0 OR NEW.admin_seats < 1 OR NEW.storefront_share_bps NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION 'Invalid club contract capacity or share';
  END IF;
  SELECT count(*) INTO used FROM public.org_seats WHERE organization_id = NEW.id
    AND ((coach_id IS NOT NULL AND released_at IS NULL) OR reserved_invite_id IS NOT NULL);
  SELECT count(*) INTO admins FROM public.org_admins WHERE organization_id = NEW.id;
  IF NEW.coach_seats < used OR NEW.admin_seats < admins THEN RAISE EXCEPTION 'Release occupied seats or remove admins before reducing capacity'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.coach_seats < OLD.coach_seats THEN
    DELETE FROM public.org_seats WHERE id IN (
      SELECT id FROM public.org_seats WHERE organization_id = NEW.id
        AND (coach_id IS NULL OR released_at IS NOT NULL) AND reserved_invite_id IS NULL
      ORDER BY seat_no DESC LIMIT (OLD.coach_seats - NEW.coach_seats));
  END IF;
  INSERT INTO public.org_seats (organization_id, seat_no)
    SELECT NEW.id, n FROM generate_series(1, NEW.coach_seats + coalesce((SELECT max(seat_no) FROM public.org_seats WHERE organization_id = NEW.id), 0)) n
    WHERE NOT EXISTS (SELECT 1 FROM public.org_seats WHERE organization_id = NEW.id AND seat_no = n)
    ORDER BY n LIMIT greatest(0, NEW.coach_seats - (SELECT count(*) FROM public.org_seats WHERE organization_id = NEW.id));
  RETURN NEW;
END $$;
CREATE TRIGGER club_seat_capacity AFTER INSERT OR UPDATE OF coach_seats, admin_seats, storefront_share_bps ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.sync_club_seat_capacity();

-- All membership paths (web, native, staff, and invite acceptance) share this boundary.
CREATE FUNCTION public.sync_coach_club_seat() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE selected_seat uuid; email_address text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN RETURN NEW; END IF;
  -- Lock both clubs in deterministic order before moving a coach.
  PERFORM id FROM public.organizations WHERE id IN (NEW.organization_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.organization_id ELSE NULL END) ORDER BY id FOR UPDATE;
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
    SELECT s.id INTO selected_seat FROM public.org_seats s
      LEFT JOIN public.org_coach_invites i ON i.id = s.reserved_invite_id
      WHERE s.organization_id = NEW.organization_id AND (s.coach_id IS NULL OR s.released_at IS NOT NULL)
        AND (s.reserved_invite_id IS NULL OR (i.status = 'pending' AND i.expires_at > now() AND lower(i.email) = lower(email_address)))
      ORDER BY (s.reserved_invite_id IS NOT NULL) DESC, s.seat_no LIMIT 1 FOR UPDATE OF s;
    IF selected_seat IS NULL THEN RAISE EXCEPTION 'No coach seat is available in this club'; END IF;
    UPDATE public.org_seats SET coach_id = NEW.id, filled_at = now(), released_at = NULL, grace_until = NULL, reserved_invite_id = NULL WHERE id = selected_seat;
  END IF;
  RETURN NEW;
END $$;
-- After insert avoids a seat FK pointing at a not-yet-inserted coach; updates use BEFORE to set grace.
CREATE TRIGGER coach_club_seat_update BEFORE UPDATE OF organization_id ON public.coach_profiles FOR EACH ROW EXECUTE FUNCTION public.sync_coach_club_seat();
CREATE TRIGGER coach_club_seat_insert AFTER INSERT ON public.coach_profiles FOR EACH ROW WHEN (NEW.organization_id IS NOT NULL) EXECUTE FUNCTION public.sync_coach_club_seat();

CREATE FUNCTION public.reserve_club_invite_seat() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE selected_seat uuid;
BEGIN
  PERFORM id FROM public.organizations WHERE id = NEW.organization_id FOR UPDATE;
  IF NEW.status <> 'pending' OR NEW.expires_at <= now() THEN
    UPDATE public.org_seats SET reserved_invite_id = NULL WHERE reserved_invite_id = NEW.id;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.org_seats WHERE reserved_invite_id = NEW.id) THEN RETURN NEW; END IF;
  UPDATE public.org_seats SET reserved_invite_id = NULL WHERE organization_id = NEW.organization_id
    AND reserved_invite_id IN (SELECT id FROM public.org_coach_invites WHERE status <> 'pending' OR expires_at <= now());
  SELECT id INTO selected_seat FROM public.org_seats WHERE organization_id = NEW.organization_id
    AND (coach_id IS NULL OR released_at IS NOT NULL) AND reserved_invite_id IS NULL ORDER BY seat_no LIMIT 1 FOR UPDATE;
  IF selected_seat IS NULL THEN RAISE EXCEPTION 'No coach seat is available for this invitation'; END IF;
  UPDATE public.org_seats SET reserved_invite_id = NEW.id WHERE id = selected_seat;
  RETURN NEW;
END $$;
CREATE TRIGGER reserve_club_invite_seat AFTER INSERT OR UPDATE OF status, expires_at ON public.org_coach_invites
  FOR EACH ROW EXECUTE FUNCTION public.reserve_club_invite_seat();

CREATE FUNCTION public.guard_club_admin_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org_id uuid; capacity integer;
BEGIN
  org_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  SELECT admin_seats INTO capacity FROM public.organizations WHERE id = org_id FOR UPDATE;
  IF TG_OP = 'INSERT' AND (SELECT count(*) FROM public.org_admins WHERE organization_id = org_id) >= capacity THEN
    RAISE EXCEPTION 'No admin seat is available';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'UPDATE' AND (NEW.organization_id <> OLD.organization_id OR NEW.user_id <> OLD.user_id) THEN
      RAISE EXCEPTION 'Remove and add club membership instead of changing its identity';
    END IF;
    IF TG_OP = 'DELETE' AND (SELECT count(*) FROM public.org_admins WHERE organization_id = org_id) <= 1 THEN RAISE EXCEPTION 'The last club admin cannot be removed'; END IF;
    IF OLD.club_role = 'owner' AND (TG_OP = 'DELETE' OR NEW.club_role <> 'owner')
      AND NOT EXISTS (SELECT 1 FROM public.org_admins WHERE organization_id = org_id AND club_role = 'owner' AND id <> OLD.id) THEN
      RAISE EXCEPTION 'The last club owner cannot be removed';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_club_admin_capacity BEFORE INSERT OR UPDATE OR DELETE ON public.org_admins
  FOR EACH ROW EXECUTE FUNCTION public.guard_club_admin_capacity();
-- Existing permissive policies remain, but browser writes cannot bypass server authorization.
CREATE POLICY "Club admin inserts require server" ON public.org_admins AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "Club admin updates require server" ON public.org_admins AS RESTRICTIVE FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "Club admin deletes require server" ON public.org_admins AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

CREATE FUNCTION public.club_remove_admin(p_org_id uuid, p_admin_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM id FROM public.organizations WHERE id = p_org_id FOR UPDATE;
  DELETE FROM public.org_admins WHERE organization_id = p_org_id AND id = p_admin_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Club admin not found'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.club_remove_admin(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_remove_admin(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.sync_club_seat_capacity(), public.sync_coach_club_seat(), public.reserve_club_invite_seat(), public.guard_club_admin_capacity() FROM PUBLIC, anon, authenticated;