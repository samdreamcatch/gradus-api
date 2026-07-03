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
  _moves jsonb;
BEGIN
  IF _token IS NULL OR length(_token) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT id, coach_id, title, notes, shared_at
    INTO _plan
  FROM plans
  WHERE share_token = _token
  LIMIT 1;

  IF _plan.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT first_name, last_name INTO _coach FROM coach_profiles WHERE id = _plan.coach_id;

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
    'coachFirstName', COALESCE(_coach.first_name, 'A Gradus coach'),
    'coachLastName', COALESCE(_coach.last_name, ''),
    'moves', _moves
  );
END;
$$;