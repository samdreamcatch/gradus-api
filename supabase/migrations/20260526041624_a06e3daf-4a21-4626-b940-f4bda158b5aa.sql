-- Shared updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- coach_profiles
CREATE TABLE public.coach_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  onboarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.coach_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coaches can view own profile"
  ON public.coach_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Coaches can insert own profile"
  ON public.coach_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Coaches can update own profile"
  ON public.coach_profiles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Coaches can delete own profile"
  ON public.coach_profiles FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_coach_profiles_updated_at
  BEFORE UPDATE ON public.coach_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- coach_levels
CREATE TABLE public.coach_levels (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  coach_id UUID NOT NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  sport TEXT NOT NULL,
  level_key TEXT NOT NULL,
  practice_hours_per_week NUMERIC(4,1) NOT NULL DEFAULT 0
    CHECK (practice_hours_per_week >= 0 AND practice_hours_per_week <= 40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (coach_id, sport, level_key)
);

CREATE INDEX idx_coach_levels_coach_id ON public.coach_levels(coach_id);

ALTER TABLE public.coach_levels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coaches can view own levels"
  ON public.coach_levels FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.coach_profiles cp
    WHERE cp.id = coach_levels.coach_id AND cp.user_id = auth.uid()
  ));

CREATE POLICY "Coaches can insert own levels"
  ON public.coach_levels FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.coach_profiles cp
    WHERE cp.id = coach_levels.coach_id AND cp.user_id = auth.uid()
  ));

CREATE POLICY "Coaches can update own levels"
  ON public.coach_levels FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.coach_profiles cp
    WHERE cp.id = coach_levels.coach_id AND cp.user_id = auth.uid()
  ));

CREATE POLICY "Coaches can delete own levels"
  ON public.coach_levels FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.coach_profiles cp
    WHERE cp.id = coach_levels.coach_id AND cp.user_id = auth.uid()
  ));

CREATE TRIGGER update_coach_levels_updated_at
  BEFORE UPDATE ON public.coach_levels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();