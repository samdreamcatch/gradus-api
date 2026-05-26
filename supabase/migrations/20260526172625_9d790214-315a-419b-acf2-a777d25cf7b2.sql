ALTER TABLE public.athlete_lesson_slots
  ADD COLUMN IF NOT EXISTS weeks_of_month smallint[] NOT NULL DEFAULT '{}';

-- Validate weeks_of_month values are between 1 and 5 (5 = last week of month)
ALTER TABLE public.athlete_lesson_slots
  DROP CONSTRAINT IF EXISTS athlete_lesson_slots_weeks_of_month_check;
ALTER TABLE public.athlete_lesson_slots
  ADD CONSTRAINT athlete_lesson_slots_weeks_of_month_check
  CHECK (weeks_of_month <@ ARRAY[1,2,3,4,5]::smallint[]);