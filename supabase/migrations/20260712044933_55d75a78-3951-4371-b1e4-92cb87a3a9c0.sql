ALTER TABLE public.plans DROP CONSTRAINT plans_kind_athlete_chk;
ALTER TABLE public.plans ADD CONSTRAINT plans_kind_athlete_chk CHECK (
  (kind = 'template' AND athlete_id IS NULL)
  OR (kind = 'plan')
);