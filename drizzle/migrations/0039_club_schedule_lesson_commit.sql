ALTER TABLE public.org_schedule_imports ADD COLUMN committed_at timestamptz, ADD COLUMN committed_by uuid, ADD COLUMN commit_counts jsonb;
CREATE FUNCTION public.club_commit_schedule_review(p_org uuid, p_user uuid, p_import uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE imp public.org_schedule_imports; r jsonb; student uuid; coach uuid; lesson uuid; added integer := 0; skipped integer := 0; d integer; st integer; len integer; freq text; anchor date; weeks smallint[];
BEGIN
 IF NOT public.has_org_admin(p_user,p_org) THEN RAISE EXCEPTION 'Not authorized for this club'; END IF;
 PERFORM id FROM public.organizations WHERE id=p_org FOR UPDATE;
 SELECT * INTO imp FROM public.org_schedule_imports WHERE id=p_import AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Import not found'; END IF;
 IF imp.committed_at IS NOT NULL THEN RETURN imp.commit_counts; END IF;
 IF imp.status <> 'ready' THEN RAISE EXCEPTION 'Finish reviewing this import'; END IF;
 FOR r IN SELECT review_row FROM public.org_schedule_import_rows WHERE import_id=p_import AND organization_id=p_org ORDER BY row_no LOOP
  student := (r->>'athleteId')::uuid; coach := (r->>'coachId')::uuid;
  IF student IS NULL OR coach IS NULL THEN RAISE EXCEPTION 'Match an existing student and seated coach'; END IF;
  PERFORM c.id FROM public.coach_profiles c JOIN public.org_seats s ON s.coach_id=c.id AND s.organization_id=p_org WHERE c.id=coach AND c.organization_id=p_org FOR UPDATE OF c;
  IF NOT FOUND THEN RAISE EXCEPTION 'Coach no longer holds a club seat'; END IF;
  PERFORM id FROM public.coach_athletes WHERE athlete_id=student AND coach_id=coach FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student is not on this coach roster'; END IF;
  PERFORM id FROM public.athletes WHERE id=student AND account_state='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student is no longer active'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organization_sports WHERE organization_id=p_org AND sport=r->>'sport') THEN RAISE EXCEPTION 'Choose a club sport'; END IF;
  d := (r->>'dayOfWeek')::integer; st := (r->>'startMinute')::integer; len := (r->>'lengthMinutes')::integer; freq := r->>'frequency'; anchor := (r->>'startsOn')::date;
  SELECT COALESCE(array_agg(value::smallint),'{}'::smallint[]) INTO weeks FROM jsonb_array_elements_text(COALESCE(r->'weeksOfMonth','[]'::jsonb));
  IF d IS NULL OR d NOT BETWEEN 0 AND 6 OR st IS NULL OR st NOT BETWEEN 0 AND 1439 OR len IS NULL OR len < 1 OR st+len > 1440 OR anchor IS NULL OR freq IS NULL OR freq NOT IN ('weekly','biweekly','monthly','twice_monthly') THEN RAISE EXCEPTION 'Confirm lesson day, time and start date'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(weeks) w WHERE w NOT BETWEEN 1 AND 5) OR cardinality(weeks) <> (SELECT count(DISTINCT w) FROM unnest(weeks) w) OR (freq='monthly' AND cardinality(weeks)<>1) OR (freq='twice_monthly' AND cardinality(weeks)<>2) THEN RAISE EXCEPTION 'Confirm recurrence weeks'; END IF;
  SELECT id INTO lesson FROM public.athlete_lesson_slots WHERE athlete_id=student AND coach_id=coach AND day_of_week=d AND start_minute=st AND end_minute=st+len AND frequency=freq AND (freq<>'biweekly' OR starts_on=anchor) AND (freq NOT IN ('monthly','twice_monthly') OR weeks_of_month @> weeks AND weeks_of_month <@ weeks) LIMIT 1;
  IF lesson IS NOT NULL THEN skipped := skipped+1;
  ELSE
   INSERT INTO public.athlete_lesson_slots(athlete_id,coach_id,day_of_week,start_minute,end_minute,frequency,starts_on,weeks_of_month) VALUES(student,coach,d,st,st+len,freq,anchor,CASE WHEN freq IN ('monthly','twice_monthly') THEN weeks ELSE '{}'::smallint[] END);
   added := added+1;
  END IF;
 END LOOP;
 UPDATE public.org_schedule_imports SET committed_at=now(), committed_by=p_user, commit_counts=jsonb_build_object('added',added,'skipped',skipped) WHERE id=p_import AND organization_id=p_org;
 RETURN jsonb_build_object('added',added,'skipped',skipped);
END $$;
REVOKE ALL ON FUNCTION public.club_commit_schedule_review(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_commit_schedule_review(uuid,uuid,uuid) TO service_role;