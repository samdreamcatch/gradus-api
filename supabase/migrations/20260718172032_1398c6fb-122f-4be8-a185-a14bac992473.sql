CREATE OR REPLACE FUNCTION public.validate_message_plan()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _plan record;
  _room record;
  _dr record;
BEGIN
  IF NEW.plan_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT coach_id, athlete_id, kind, status INTO _plan FROM plans WHERE id = NEW.plan_id;
  IF _plan IS NULL THEN
    RAISE EXCEPTION 'Plan not found';
  END IF;
  IF _plan.kind <> 'plan' THEN
    RAISE EXCEPTION 'Only plans can be tagged';
  END IF;

  IF NEW.direct_room_id IS NOT NULL THEN
    SELECT user_a, user_b, kind INTO _dr FROM direct_rooms WHERE id = NEW.direct_room_id;
    IF _dr IS NULL THEN
      RAISE EXCEPTION 'Direct room not found';
    END IF;
    IF _dr.kind <> 'coach_coach' THEN
      RAISE EXCEPTION 'Plans can only be tagged in coach-to-coach direct messages';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM coach_profiles cp
      JOIN coach_athletes ca ON ca.coach_id = cp.id
      WHERE cp.user_id IN (_dr.user_a, _dr.user_b)
        AND ca.athlete_id = _plan.athlete_id
      GROUP BY ca.athlete_id
      HAVING COUNT(DISTINCT cp.user_id) = 2
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM coach_profiles cp
        WHERE cp.id = _plan.coach_id
          AND cp.user_id IN (_dr.user_a, _dr.user_b)
      ) THEN
        RAISE EXCEPTION 'Plan does not belong to this conversation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  SELECT coach_id, athlete_id INTO _room FROM message_rooms WHERE id = NEW.room_id;
  IF _room IS NULL THEN
    RAISE EXCEPTION 'Room not found';
  END IF;
  IF _plan.coach_id <> _room.coach_id OR _plan.athlete_id <> _room.athlete_id THEN
    RAISE EXCEPTION 'Plan does not belong to this conversation';
  END IF;
  RETURN NEW;
END;
$function$;