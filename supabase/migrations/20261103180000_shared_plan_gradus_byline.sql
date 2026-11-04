-- get_shared_plan filled in "A Gradus coach" as the first name of a plan with
-- no coach behind it, and the share page prefixed "Coach", so the byline read
-- "Plan by Coach A Gradus coach". The name is now empty when nobody is named
-- and the page says "Plan by Gradus". Only the two fallbacks change; the rest
-- is as in drizzle/migrations/0025_social_plan_editing.sql.

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
      THEN COALESCE(_plan.social_coach_name, '')
      ELSE COALESCE(_coach.first_name, '') END;
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
