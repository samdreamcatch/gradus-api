ALTER TABLE public.parent_profiles
  DROP CONSTRAINT IF EXISTS parent_profiles_adult_verification_method_check;

ALTER TABLE public.parent_profiles
  ADD CONSTRAINT parent_profiles_adult_verification_method_check
  CHECK (
    adult_verification_method IS NULL
    OR adult_verification_method IN ('kws_card', 'kws', 'admin', 'legacy')
  );