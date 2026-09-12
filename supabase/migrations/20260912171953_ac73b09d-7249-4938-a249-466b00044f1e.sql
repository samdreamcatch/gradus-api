CREATE TABLE IF NOT EXISTS public.lesson_reminders_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL,
  athlete_id uuid NOT NULL,
  coach_id uuid,
  lesson_date date NOT NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_id, lesson_date)
);

GRANT ALL ON public.lesson_reminders_sent TO service_role;

ALTER TABLE public.lesson_reminders_sent ENABLE ROW LEVEL SECURITY;