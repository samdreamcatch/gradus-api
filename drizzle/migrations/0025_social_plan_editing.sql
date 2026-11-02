ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS social_coach_name text NOT NULL DEFAULT '';

-- Atomic replacement: a failure leaves the original plan and its moves intact.
CREATE OR REPLACE FUNCTION public.admin_update_social_plan(
  _plan_id uuid, _title text, _notes text, _coach_name text, _moves jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  PERFORM id FROM public.plans WHERE id = _plan_id AND kind = 'template'
    AND source = 'gradus' AND coach_id IS NULL AND athlete_id IS NULL
    AND share_token IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only admin-created social plans can be edited here'; END IF;
  IF length(trim(_title)) NOT BETWEEN 1 AND 140 OR length(_notes) > 1000
    OR length(_coach_name) > 120 OR jsonb_typeof(_moves) <> 'array'
    OR jsonb_array_length(_moves) NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'Invalid plan';
  END IF;
  UPDATE public.plans SET title = trim(_title), notes = trim(_notes),
    social_coach_name = trim(_coach_name), updated_at = now() WHERE id = _plan_id;
  DELETE FROM public.plan_moves WHERE plan_id = _plan_id;
  INSERT INTO public.plan_moves(plan_id, position, name, description, cue, why, target_kind, target_value)
    SELECT _plan_id, ord::integer, trim(m->>'name'), COALESCE(m->>'description', ''),
      COALESCE(m->>'cue', ''), COALESCE(m->>'why', ''), m->>'targetKind', (m->>'targetValue')::numeric
    FROM jsonb_array_elements(_moves) WITH ORDINALITY AS t(m, ord);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_social_plan(uuid, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_social_plan(uuid, text, text, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_shared_plan(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _plan record;
  _coach record;
  _athlete record;
  _moves jsonb;
  _kind text;
  _author_first text;
  _coach_last text := '';
BEGIN
  IF _token IS NULL OR length(_token) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT id, coach_id, athlete_id, source, title, notes, shared_at, social_coach_name
    INTO _plan
  FROM plans
  WHERE share_token = _token
  LIMIT 1;

  IF _plan.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF _plan.source = 'athlete' THEN
    SELECT first_name INTO _athlete FROM athletes WHERE id = _plan.athlete_id;
    IF _athlete.first_name IS NULL OR is_athlete_paused(_plan.athlete_id) THEN
      RETURN NULL;
    END IF;
    _kind := 'athlete';
    _author_first := _athlete.first_name;
  ELSE
    SELECT first_name, last_name INTO _coach FROM coach_profiles WHERE id = _plan.coach_id;
    _kind := 'coach';
    _author_first := CASE WHEN _plan.source = 'gradus' AND _plan.coach_id IS NULL
      THEN COALESCE(NULLIF(_plan.social_coach_name, ''), 'A Gradus coach')
      ELSE COALESCE(_coach.first_name, 'A Gradus coach') END;
    _coach_last := COALESCE(_coach.last_name, '');
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'position', pm.position,
        'name', pm.name,
        'description', pm.description,
        'cue', pm.cue,
        'why', pm.why,
        'targetKind', pm.target_kind,
        'targetValue', pm.target_value
      )
      ORDER BY pm.position
    ),
    '[]'::jsonb
  )
  INTO _moves
  FROM plan_moves pm
  WHERE pm.plan_id = _plan.id;

  RETURN jsonb_build_object(
    'title', _plan.title,
    'notes', _plan.notes,
    'sharedAt', _plan.shared_at,
    'authorKind', _kind,
    'authorFirstName', _author_first,
    'coachFirstName', CASE WHEN _kind = 'athlete' THEN '' ELSE _author_first END,
    'coachLastName', _coach_last,
    'moves', _moves
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_shared_plan(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_plan(text) TO anon, authenticated, service_role;
