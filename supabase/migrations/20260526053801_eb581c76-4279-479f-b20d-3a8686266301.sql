
-- parent_profiles
CREATE TABLE public.parent_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.parent_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Parents can view own profile" ON public.parent_profiles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Parents can insert own profile" ON public.parent_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Parents can update own profile" ON public.parent_profiles
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Parents can delete own profile" ON public.parent_profiles
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_parent_profiles_updated_at
  BEFORE UPDATE ON public.parent_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- athletes
CREATE TABLE public.athletes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES public.parent_profiles(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_athletes_parent_id ON public.athletes(parent_id);
ALTER TABLE public.athletes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Parents can view own athletes" ON public.athletes
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.parent_profiles pp
    WHERE pp.id = athletes.parent_id AND pp.user_id = auth.uid()
  ));
CREATE POLICY "Parents can insert own athletes" ON public.athletes
  FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM public.parent_profiles pp
    WHERE pp.id = athletes.parent_id AND pp.user_id = auth.uid()
  ));
CREATE POLICY "Parents can update own athletes" ON public.athletes
  FOR UPDATE USING (EXISTS (
    SELECT 1 FROM public.parent_profiles pp
    WHERE pp.id = athletes.parent_id AND pp.user_id = auth.uid()
  ));
CREATE POLICY "Parents can delete own athletes" ON public.athletes
  FOR DELETE USING (EXISTS (
    SELECT 1 FROM public.parent_profiles pp
    WHERE pp.id = athletes.parent_id AND pp.user_id = auth.uid()
  ));

CREATE TRIGGER update_athletes_updated_at
  BEFORE UPDATE ON public.athletes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- coach_athletes link table
CREATE TABLE public.coach_athletes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coach_id, athlete_id)
);
CREATE INDEX idx_coach_athletes_coach_id ON public.coach_athletes(coach_id);
CREATE INDEX idx_coach_athletes_athlete_id ON public.coach_athletes(athlete_id);
ALTER TABLE public.coach_athletes ENABLE ROW LEVEL SECURITY;

-- Parents manage links for their own athletes
CREATE POLICY "Parents can view own coach links" ON public.coach_athletes
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.athletes a
    JOIN public.parent_profiles pp ON pp.id = a.parent_id
    WHERE a.id = coach_athletes.athlete_id AND pp.user_id = auth.uid()
  ));
CREATE POLICY "Parents can insert coach links for own athletes" ON public.coach_athletes
  FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM public.athletes a
    JOIN public.parent_profiles pp ON pp.id = a.parent_id
    WHERE a.id = coach_athletes.athlete_id AND pp.user_id = auth.uid()
  ));
CREATE POLICY "Parents can delete own coach links" ON public.coach_athletes
  FOR DELETE USING (EXISTS (
    SELECT 1 FROM public.athletes a
    JOIN public.parent_profiles pp ON pp.id = a.parent_id
    WHERE a.id = coach_athletes.athlete_id AND pp.user_id = auth.uid()
  ));

-- Coaches can see their roster and remove athletes from it
CREATE POLICY "Coaches can view own roster links" ON public.coach_athletes
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.coach_profiles cp
    WHERE cp.id = coach_athletes.coach_id AND cp.user_id = auth.uid()
  ));
CREATE POLICY "Coaches can delete own roster links" ON public.coach_athletes
  FOR DELETE USING (EXISTS (
    SELECT 1 FROM public.coach_profiles cp
    WHERE cp.id = coach_athletes.coach_id AND cp.user_id = auth.uid()
  ));

-- Coaches can read the athletes on their roster (and those athletes' parent names)
CREATE POLICY "Coaches can view rostered athletes" ON public.athletes
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.coach_athletes ca
    JOIN public.coach_profiles cp ON cp.id = ca.coach_id
    WHERE ca.athlete_id = athletes.id AND cp.user_id = auth.uid()
  ));
CREATE POLICY "Coaches can view parents of rostered athletes" ON public.parent_profiles
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.athletes a
    JOIN public.coach_athletes ca ON ca.athlete_id = a.id
    JOIN public.coach_profiles cp ON cp.id = ca.coach_id
    WHERE a.parent_id = parent_profiles.id AND cp.user_id = auth.uid()
  ));
