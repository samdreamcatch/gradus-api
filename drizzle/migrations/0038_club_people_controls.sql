CREATE OR REPLACE FUNCTION public.club_set_admin_role(p_org_id uuid, p_admin_id uuid, p_role text, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF p_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Unknown role'; END IF;
  PERFORM id FROM public.organizations WHERE id = p_org_id FOR UPDATE;
  UPDATE public.org_admins SET club_role = p_role WHERE organization_id = p_org_id AND id = p_admin_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Club admin not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_admins WHERE organization_id = p_org_id AND club_role = 'owner') THEN
    RAISE EXCEPTION 'A club needs at least one owner';
  END IF;
  INSERT INTO public.org_admin_actions(actor_user_id, organization_id, action, payload)
    VALUES (p_actor, p_org_id, 'admin.role_changed', jsonb_build_object('adminId', p_admin_id, 'role', p_role));
END $$;

CREATE OR REPLACE FUNCTION public.club_release_coach(p_org_id uuid, p_coach_id uuid, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.coach_profiles SET organization_id = NULL WHERE id = p_coach_id AND organization_id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Coach is not in this club'; END IF;
  INSERT INTO public.org_admin_actions(actor_user_id, organization_id, target_coach_id, action, payload)
    VALUES (p_actor, p_org_id, p_coach_id, 'coach.seat_released', '{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.club_assign_waiting_coach(p_org_id uuid, p_request_id uuid, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE req public.club_seat_requests; joined uuid;
BEGIN
  SELECT * INTO req FROM public.club_seat_requests WHERE id = p_request_id AND organization_id = p_org_id AND resolved_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'This request is no longer waiting'; END IF;
  IF EXISTS (SELECT 1 FROM public.coach_profiles WHERE id = req.coach_id AND organization_id IS NOT NULL AND organization_id <> p_org_id) THEN
    RAISE EXCEPTION 'This coach has joined another club';
  END IF;
  UPDATE public.coach_profiles SET organization_id = p_org_id, entitlement = 'club_covered' WHERE id = req.coach_id;
  SELECT organization_id INTO joined FROM public.coach_profiles WHERE id = req.coach_id;
  IF joined IS DISTINCT FROM p_org_id THEN RAISE EXCEPTION 'No open coach seat. Release a seat first.'; END IF;
  INSERT INTO public.org_admin_actions(actor_user_id, organization_id, target_coach_id, action, payload)
    VALUES (p_actor, p_org_id, req.coach_id, 'coach.seat_assigned', jsonb_build_object('requestId', p_request_id));
END $$;

REVOKE ALL ON FUNCTION public.club_set_admin_role(uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.club_release_coach(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.club_assign_waiting_coach(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_set_admin_role(uuid,uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.club_release_coach(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.club_assign_waiting_coach(uuid,uuid,uuid) TO service_role;