
CREATE TABLE public.pre_lesson_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  lesson_date date NOT NULL,
  narrative text NOT NULL,
  source_hash text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coach_id, athlete_id, lesson_date)
);

GRANT SELECT ON public.pre_lesson_briefings TO authenticated;
GRANT ALL ON public.pre_lesson_briefings TO service_role;

ALTER TABLE public.pre_lesson_briefings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coaches can view their own pre-lesson briefings"
ON public.pre_lesson_briefings
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.coach_profiles cp
    WHERE cp.id = pre_lesson_briefings.coach_id
      AND cp.user_id = auth.uid()
  )
);

CREATE TRIGGER update_pre_lesson_briefings_updated_at
BEFORE UPDATE ON public.pre_lesson_briefings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
