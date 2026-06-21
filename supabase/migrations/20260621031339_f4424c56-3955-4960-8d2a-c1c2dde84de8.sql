ALTER TABLE public.coach_profiles ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE public.parent_profiles ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS coach_profiles_is_test_idx ON public.coach_profiles(is_test);
CREATE INDEX IF NOT EXISTS parent_profiles_is_test_idx ON public.parent_profiles(is_test);