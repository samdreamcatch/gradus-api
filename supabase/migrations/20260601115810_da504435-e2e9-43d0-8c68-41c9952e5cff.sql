ALTER TABLE public.messages ADD COLUMN plan_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_messages_plan_id ON public.messages(plan_id);

CREATE OR REPLACE FUNCTION public.validate_message_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _room record;
  _plan record;
BEGIN
  IF NEW.plan_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT coach_id, athlete_id INTO _room FROM message_rooms WHERE id = NEW.room_id;
  IF _room IS NULL THEN
    RAISE EXCEPTION 'Room not found';
  END IF;
  SELECT coach_id, athlete_id, kind, status INTO _plan FROM plans WHERE id = NEW.plan_id;
  IF _plan IS NULL THEN
    RAISE EXCEPTION 'Plan not found';
  END IF;
  IF _plan.coach_id <> _room.coach_id OR _plan.athlete_id <> _room.athlete_id THEN
    RAISE EXCEPTION 'Plan does not belong to this conversation';
  END IF;
  IF _plan.kind <> 'plan' THEN
    RAISE EXCEPTION 'Only plans can be tagged';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_message_plan ON public.messages;
CREATE TRIGGER trg_validate_message_plan
BEFORE INSERT OR UPDATE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.validate_message_plan();