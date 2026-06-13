CREATE TABLE public.lesson_slot_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slot_id uuid NOT NULL REFERENCES public.athlete_lesson_slots(id) ON DELETE CASCADE,
  occurrence_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('canceled','rescheduled')),
  start_minute int,
  end_minute int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_id, occurrence_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lesson_slot_overrides TO authenticated;
GRANT ALL ON public.lesson_slot_overrides TO service_role;

ALTER TABLE public.lesson_slot_overrides ENABLE ROW LEVEL SECURITY;

-- Coach (owner of the parent slot) can manage overrides
CREATE POLICY "Coach can view own slot overrides"
  ON public.lesson_slot_overrides FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.athlete_lesson_slots s
    JOIN public.coach_profiles cp ON cp.id = s.coach_id
    WHERE s.id = lesson_slot_overrides.slot_id
      AND cp.user_id = auth.uid()
  ));

CREATE POLICY "Coach can insert own slot overrides"
  ON public.lesson_slot_overrides FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.athlete_lesson_slots s
    JOIN public.coach_profiles cp ON cp.id = s.coach_id
    WHERE s.id = lesson_slot_overrides.slot_id
      AND cp.user_id = auth.uid()
  ));

CREATE POLICY "Coach can update own slot overrides"
  ON public.lesson_slot_overrides FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.athlete_lesson_slots s
    JOIN public.coach_profiles cp ON cp.id = s.coach_id
    WHERE s.id = lesson_slot_overrides.slot_id
      AND cp.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.athlete_lesson_slots s
    JOIN public.coach_profiles cp ON cp.id = s.coach_id
    WHERE s.id = lesson_slot_overrides.slot_id
      AND cp.user_id = auth.uid()
  ));

CREATE POLICY "Coach can delete own slot overrides"
  ON public.lesson_slot_overrides FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.athlete_lesson_slots s
    JOIN public.coach_profiles cp ON cp.id = s.coach_id
    WHERE s.id = lesson_slot_overrides.slot_id
      AND cp.user_id = auth.uid()
  ));

-- Parents/athletes on the slot can VIEW overrides (so their schedule reflects changes)
CREATE POLICY "Athlete or parent can view slot overrides"
  ON public.lesson_slot_overrides FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.athlete_lesson_slots s
    JOIN public.athletes a ON a.id = s.athlete_id
    LEFT JOIN public.parent_profiles pp ON pp.id = a.parent_id
    WHERE s.id = lesson_slot_overrides.slot_id
      AND (a.user_id = auth.uid() OR pp.user_id = auth.uid())
  ));

-- Validation trigger: enforce times based on status
CREATE OR REPLACE FUNCTION public.validate_lesson_slot_override()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'rescheduled' THEN
    IF NEW.start_minute IS NULL OR NEW.end_minute IS NULL THEN
      RAISE EXCEPTION 'Rescheduled overrides require start_minute and end_minute';
    END IF;
    IF NEW.start_minute < 0 OR NEW.end_minute > 1440 OR NEW.start_minute >= NEW.end_minute THEN
      RAISE EXCEPTION 'Invalid time range for rescheduled override';
    END IF;
  ELSIF NEW.status = 'canceled' THEN
    IF NEW.start_minute IS NOT NULL OR NEW.end_minute IS NOT NULL THEN
      RAISE EXCEPTION 'Canceled overrides must not include time fields';
    END IF;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_lesson_slot_override
  BEFORE INSERT OR UPDATE ON public.lesson_slot_overrides
  FOR EACH ROW EXECUTE FUNCTION public.validate_lesson_slot_override();
