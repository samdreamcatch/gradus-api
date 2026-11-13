CREATE OR REPLACE FUNCTION public.guard_club_admin_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $function$
DECLARE org_id uuid;
BEGIN
  org_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  PERFORM 1 FROM public.organizations WHERE id = org_id FOR UPDATE;
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
END $function$;
CREATE OR REPLACE FUNCTION public.sync_club_seat_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $function$
DECLARE used integer;
BEGIN
  IF NEW.coach_seats < 0 OR NEW.storefront_share_bps NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION 'Invalid club contract capacity or share';
  END IF;
  SELECT count(*) INTO used FROM public.org_seats WHERE organization_id = NEW.id
    AND ((coach_id IS NOT NULL AND released_at IS NULL) OR reserved_invite_id IS NOT NULL);
  IF NEW.coach_seats < used THEN RAISE EXCEPTION 'Release occupied seats before reducing capacity'; END IF;
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
END $function$;
COMMENT ON COLUMN public.organizations.admin_seats IS 'DEPRECATED: club administrators are unlimited; only coach seats have contract capacity.';
REVOKE ALL ON FUNCTION public.guard_club_admin_capacity(), public.sync_club_seat_capacity() FROM PUBLIC, anon, authenticated;