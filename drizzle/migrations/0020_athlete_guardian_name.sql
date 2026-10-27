ALTER TABLE public.athletes
  ADD COLUMN IF NOT EXISTS guardian_first_name text,
  ADD COLUMN IF NOT EXISTS guardian_last_name text;

GRANT SELECT (guardian_first_name, guardian_last_name) ON public.athletes TO anon, authenticated;