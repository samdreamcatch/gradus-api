
CREATE TABLE public.lesson_wrap_ups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  coach_id uuid NOT NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  lesson_date date NOT NULL,
  action text NOT NULL CHECK (action IN ('edited', 'redeployed', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coach_id, athlete_id, lesson_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lesson_wrap_ups TO authenticated;
GRANT ALL ON public.lesson_wrap_ups TO service_role;

ALTER TABLE public.lesson_wrap_ups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coaches can view their own wrap-ups"
ON public.lesson_wrap_ups FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.coach_profiles cp WHERE cp.id = coach_id AND cp.user_id = auth.uid()));

CREATE POLICY "Coaches can insert their own wrap-ups"
ON public.lesson_wrap_ups FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.coach_profiles cp WHERE cp.id = coach_id AND cp.user_id = auth.uid()));

CREATE POLICY "Coaches can update their own wrap-ups"
ON public.lesson_wrap_ups FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.coach_profiles cp WHERE cp.id = coach_id AND cp.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.coach_profiles cp WHERE cp.id = coach_id AND cp.user_id = auth.uid()));

CREATE POLICY "Coaches can delete their own wrap-ups"
ON public.lesson_wrap_ups FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.coach_profiles cp WHERE cp.id = coach_id AND cp.user_id = auth.uid()));

CREATE TRIGGER update_lesson_wrap_ups_updated_at
BEFORE UPDATE ON public.lesson_wrap_ups
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
