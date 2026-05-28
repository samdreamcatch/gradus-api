-- Normalize seed_moves.sport to snake_case lowercase keys
UPDATE seed_moves SET sport = lower(replace(sport, ' ', '_'));

-- Update seed function to be robust to either format going forward
CREATE OR REPLACE FUNCTION public.seed_coach_library(_coach_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _user_id uuid;
  _inserted integer := 0;
BEGIN
  SELECT user_id INTO _user_id FROM coach_profiles WHERE id = _coach_id;
  IF _user_id IS NULL OR _user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  INSERT INTO moves (coach_id, sport, category, name, description, cue, why,
                     default_target_kind, default_target_value)
  SELECT _coach_id, sm.sport, sm.category, sm.name, sm.description, sm.cue, sm.why,
         sm.default_target_kind, sm.default_target_value
  FROM seed_moves sm
  WHERE EXISTS (
    SELECT 1 FROM coach_levels cl
    WHERE cl.coach_id = _coach_id
      AND lower(replace(cl.sport, ' ', '_')) = lower(replace(sm.sport, ' ', '_'))
  )
  AND NOT EXISTS (
    SELECT 1 FROM moves m
    WHERE m.coach_id = _coach_id
      AND lower(replace(m.sport, ' ', '_')) = lower(replace(sm.sport, ' ', '_'))
      AND m.name = sm.name
  );
  GET DIAGNOSTICS _inserted = ROW_COUNT;
  RETURN _inserted;
END;
$function$;

-- Backfill: copy matching seeds into any coach library missing them
INSERT INTO moves (coach_id, sport, category, name, description, cue, why, default_target_kind, default_target_value)
SELECT cp.id, sm.sport, sm.category, sm.name, sm.description, sm.cue, sm.why, sm.default_target_kind, sm.default_target_value
FROM coach_profiles cp
JOIN seed_moves sm ON EXISTS (
  SELECT 1 FROM coach_levels cl
  WHERE cl.coach_id = cp.id
    AND lower(replace(cl.sport, ' ', '_')) = lower(replace(sm.sport, ' ', '_'))
)
WHERE NOT EXISTS (
  SELECT 1 FROM moves m
  WHERE m.coach_id = cp.id
    AND lower(replace(m.sport, ' ', '_')) = lower(replace(sm.sport, ' ', '_'))
    AND m.name = sm.name
);