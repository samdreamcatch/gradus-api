-- A plan saved from a Gradus share link (no coach behind it) was titled
-- "… (from Coach Gradus)". It now reads "… (from Gradus)", matching how the
-- apps attribute Gradus plans; a coach's share still reads "(from Coach Ava)".
-- Only the title line changes; the rest of import_shared_plan is as in
-- 20261006010000_athlete_authored_plans.sql.

CREATE OR REPLACE FUNCTION public.import_shared_plan(_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _src_plan record;
  _importer_coach_id uuid;
  _importer_athlete_id uuid;
  _src_author_first text;
  _src_athlete record;
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
    SELECT id INTO _importer_athlete_id
    FROM athletes
    WHERE user_id = auth.uid()
    ORDER BY created_at, id
    LIMIT 1;

    IF _importer_athlete_id IS NULL THEN
      RAISE EXCEPTION 'Only coaches and athletes can save shared plans' USING ERRCODE = '42501';
    END IF;
    -- A paused athlete saves nothing new, whichever of their rows is asked.
    IF is_athlete_paused(_importer_athlete_id) THEN
      RAISE EXCEPTION 'This account is paused' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT id, coach_id, athlete_id, source, title, notes
    INTO _src_plan
  FROM plans
  WHERE share_token = _token
  LIMIT 1;

  IF _src_plan.id IS NULL THEN
    RAISE EXCEPTION 'Shared plan not found' USING ERRCODE = 'P0002';
  END IF;

  IF _src_plan.source = 'athlete' THEN
    SELECT first_name INTO _src_athlete FROM athletes WHERE id = _src_plan.athlete_id;
    -- A paused athlete's links stop working (get_shared_plan says the same).
    IF _src_athlete.first_name IS NULL OR is_athlete_paused(_src_plan.athlete_id) THEN
      RAISE EXCEPTION 'Shared plan not found' USING ERRCODE = 'P0002';
    END IF;
    _src_author_first := _src_athlete.first_name;
    _new_title := COALESCE(NULLIF(_src_plan.title, ''), 'Untitled plan')
                  || ' (from ' || _src_author_first || ')';
  ELSE
    SELECT first_name INTO _src_author_first FROM coach_profiles WHERE id = _src_plan.coach_id;
    _new_title := COALESCE(NULLIF(_src_plan.title, ''), 'Untitled plan')
                  || CASE
                       WHEN NULLIF(_src_author_first, '') IS NULL THEN ' (from Gradus)'
                       ELSE ' (from Coach ' || _src_author_first || ')'
                     END;
  END IF;

  IF _importer_coach_id IS NOT NULL THEN
    INSERT INTO plans (coach_id, title, notes, kind, athlete_id, status)
    VALUES (_importer_coach_id, _new_title, _src_plan.notes, 'template', NULL, 'benched')
    RETURNING id INTO _new_plan_id;
  ELSE
    INSERT INTO plans (coach_id, title, notes, kind, athlete_id, status, source)
    VALUES (NULL, _new_title, _src_plan.notes, 'plan', _importer_athlete_id, 'active', 'athlete')
    RETURNING id INTO _new_plan_id;
  END IF;

  FOR _row IN
    SELECT pm.position, pm.move_id, pm.name, pm.description, pm.cue, pm.why,
           pm.target_kind, pm.target_value
    FROM plan_moves pm
    WHERE pm.plan_id = _src_plan.id
    ORDER BY pm.position
  LOOP
    _target_move_id := NULL;
    _src_sport := NULL;

    -- Only follow a move into the SOURCE coach's own library: a plan_move's
    -- move_id is not otherwise vouched for.
    IF _importer_coach_id IS NOT NULL AND _row.move_id IS NOT NULL THEN
      SELECT sport INTO _src_sport
      FROM moves
      WHERE id = _row.move_id
        AND coach_id IS NOT DISTINCT FROM _src_plan.coach_id;
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
          AND m.coach_id IS NOT DISTINCT FROM _src_plan.coach_id
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

-- Titles already saved with the old suffix.
UPDATE plans
SET title = left(title, length(title) - length(' (from Coach Gradus)')) || ' (from Gradus)'
WHERE title LIKE '% (from Coach Gradus)';
