
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS share_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS shared_at timestamptz;

CREATE INDEX IF NOT EXISTS plans_share_token_idx ON public.plans (share_token) WHERE share_token IS NOT NULL;

-- Public read: resolves a share token to a safe, anonymized plan snapshot.
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

  SELECT first_name INTO _coach FROM coach_profiles WHERE id = _plan.coach_id;

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
    'moves', _moves
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_shared_plan(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_plan(text) TO anon, authenticated, service_role;

-- Import: coach-only. Creates a new template under caller, copies plan_moves,
-- and materializes any missing library moves (matched by sport+name).
CREATE OR REPLACE FUNCTION public.import_shared_plan(_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _src_plan record;
  _importer_coach_id uuid;
  _src_coach_first text;
  _new_plan_id uuid;
  _new_title text;
  _row record;
  _target_move_id uuid;
  _src_sport text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO _importer_coach_id
  FROM coach_profiles
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF _importer_coach_id IS NULL THEN
    RAISE EXCEPTION 'Only coaches can save shared plans' USING ERRCODE = '42501';
  END IF;

  SELECT id, coach_id, title, notes
    INTO _src_plan
  FROM plans
  WHERE share_token = _token
  LIMIT 1;

  IF _src_plan.id IS NULL THEN
    RAISE EXCEPTION 'Shared plan not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT first_name INTO _src_coach_first FROM coach_profiles WHERE id = _src_plan.coach_id;
  _new_title := COALESCE(NULLIF(_src_plan.title, ''), 'Untitled plan')
                || ' (from Coach ' || COALESCE(_src_coach_first, 'Gradus') || ')';

  INSERT INTO plans (coach_id, title, notes, kind, athlete_id, status)
  VALUES (_importer_coach_id, _new_title, _src_plan.notes, 'template', NULL, 'benched')
  RETURNING id INTO _new_plan_id;

  FOR _row IN
    SELECT pm.position, pm.move_id, pm.name, pm.description, pm.cue, pm.why,
           pm.target_kind, pm.target_value
    FROM plan_moves pm
    WHERE pm.plan_id = _src_plan.id
    ORDER BY pm.position
  LOOP
    _target_move_id := NULL;
    _src_sport := NULL;

    IF _row.move_id IS NOT NULL THEN
      SELECT sport INTO _src_sport FROM moves WHERE id = _row.move_id;
    END IF;

    IF _src_sport IS NOT NULL THEN
      SELECT id INTO _target_move_id
      FROM moves
      WHERE coach_id = _importer_coach_id
        AND sport = _src_sport
        AND lower(name) = lower(_row.name)
      LIMIT 1;

      IF _target_move_id IS NULL THEN
        INSERT INTO moves (coach_id, sport, category, name, description, cue, why,
                           default_target_kind, default_target_value)
        SELECT _importer_coach_id, m.sport, m.category, m.name, m.description, m.cue, m.why,
               m.default_target_kind, m.default_target_value
        FROM moves m
        WHERE m.id = _row.move_id
        RETURNING id INTO _target_move_id;
      END IF;
    END IF;

    INSERT INTO plan_moves (plan_id, position, move_id, name, description, cue, why,
                            target_kind, target_value)
    VALUES (_new_plan_id, _row.position, _target_move_id, _row.name, _row.description,
            _row.cue, _row.why, _row.target_kind, _row.target_value);
  END LOOP;

  RETURN _new_plan_id;
END;
$$;

REVOKE ALL ON FUNCTION public.import_shared_plan(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_shared_plan(text) TO authenticated, service_role;
