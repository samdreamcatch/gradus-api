CREATE TABLE public.coach_athlete_practice_targets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  coach_id uuid NOT NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  sport text NOT NULL,
  hours_per_week numeric NOT NULL CHECK (hours_per_week >= 0 AND hours_per_week <= 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coach_id, athlete_id, sport)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_athlete_practice_targets TO authenticated;
GRANT ALL ON public.coach_athlete_practice_targets TO service_role;

ALTER TABLE public.coach_athlete_practice_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coach manages own practice targets"
  ON public.coach_athlete_practice_targets FOR ALL TO authenticated
  USING (public.caller_owns_coach(coach_id))
  WITH CHECK (public.caller_owns_coach(coach_id));

CREATE POLICY "Guardians can read practice targets"
  ON public.coach_athlete_practice_targets FOR SELECT TO authenticated
  USING (public.is_parent_of_athlete(athlete_id));

CREATE POLICY "Athlete can read own practice targets"
  ON public.coach_athlete_practice_targets FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.athletes a
    WHERE a.id = coach_athlete_practice_targets.athlete_id
      AND a.user_id = auth.uid()
  ));

CREATE TRIGGER coach_athlete_practice_targets_updated_at
  BEFORE UPDATE ON public.coach_athlete_practice_targets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();