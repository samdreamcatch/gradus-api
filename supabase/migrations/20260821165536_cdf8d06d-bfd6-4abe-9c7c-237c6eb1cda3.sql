ALTER TABLE public.plans
  ADD CONSTRAINT plans_coachless_must_be_gradus
  CHECK (coach_id IS NOT NULL OR source = 'gradus') NOT VALID;

ALTER TABLE public.plans VALIDATE CONSTRAINT plans_coachless_must_be_gradus;