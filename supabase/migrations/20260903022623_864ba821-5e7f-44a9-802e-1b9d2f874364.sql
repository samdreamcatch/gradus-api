ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS source_competition_id uuid REFERENCES public.competitions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS plans_athlete_source_competition_idx
  ON public.plans (athlete_id, source_competition_id);