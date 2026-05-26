
-- athlete_goals
CREATE TABLE public.athlete_goals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  athlete_id UUID NOT NULL,
  coach_id UUID NOT NULL,
  sport TEXT NOT NULL,
  current_level_key TEXT NOT NULL,
  season_goal_key TEXT NOT NULL,
  long_term_goal TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (athlete_id, coach_id, sport),
  CHECK (char_length(long_term_goal) <= 2000)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.athlete_goals TO authenticated;
GRANT ALL ON public.athlete_goals TO service_role;

ALTER TABLE public.athlete_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Parents manage goals for own athletes - select"
ON public.athlete_goals FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.athletes a
  JOIN public.parent_profiles pp ON pp.id = a.parent_id
  WHERE a.id = athlete_goals.athlete_id AND pp.user_id = auth.uid()
));
CREATE POLICY "Parents manage goals for own athletes - insert"
ON public.athlete_goals FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.athletes a
  JOIN public.parent_profiles pp ON pp.id = a.parent_id
  WHERE a.id = athlete_goals.athlete_id AND pp.user_id = auth.uid()
));
CREATE POLICY "Parents manage goals for own athletes - update"
ON public.athlete_goals FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.athletes a
  JOIN public.parent_profiles pp ON pp.id = a.parent_id
  WHERE a.id = athlete_goals.athlete_id AND pp.user_id = auth.uid()
));
CREATE POLICY "Parents manage goals for own athletes - delete"
ON public.athlete_goals FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.athletes a
  JOIN public.parent_profiles pp ON pp.id = a.parent_id
  WHERE a.id = athlete_goals.athlete_id AND pp.user_id = auth.uid()
));
CREATE POLICY "Coaches view goals for rostered athletes"
ON public.athlete_goals FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.coach_profiles cp
  WHERE cp.id = athlete_goals.coach_id AND cp.user_id = auth.uid()
));

CREATE TRIGGER update_athlete_goals_updated_at
BEFORE UPDATE ON public.athlete_goals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- athlete_lesson_slots
CREATE TABLE public.athlete_lesson_slots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  athlete_id UUID NOT NULL,
  coach_id UUID NOT NULL,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_minute SMALLINT NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute SMALLINT NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_minute > start_minute)
);
CREATE INDEX idx_athlete_lesson_slots_athlete_coach ON public.athlete_lesson_slots (athlete_id, coach_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.athlete_lesson_slots TO authenticated;
GRANT ALL ON public.athlete_lesson_slots TO service_role;

ALTER TABLE public.athlete_lesson_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Parents manage slots for own athletes - select"
ON public.athlete_lesson_slots FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.athletes a
  JOIN public.parent_profiles pp ON pp.id = a.parent_id
  WHERE a.id = athlete_lesson_slots.athlete_id AND pp.user_id = auth.uid()
));
CREATE POLICY "Parents manage slots for own athletes - insert"
ON public.athlete_lesson_slots FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.athletes a
  JOIN public.parent_profiles pp ON pp.id = a.parent_id
  WHERE a.id = athlete_lesson_slots.athlete_id AND pp.user_id = auth.uid()
));
CREATE POLICY "Parents manage slots for own athletes - update"
ON public.athlete_lesson_slots FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.athletes a
  JOIN public.parent_profiles pp ON pp.id = a.parent_id
  WHERE a.id = athlete_lesson_slots.athlete_id AND pp.user_id = auth.uid()
));
CREATE POLICY "Parents manage slots for own athletes - delete"
ON public.athlete_lesson_slots FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.athletes a
  JOIN public.parent_profiles pp ON pp.id = a.parent_id
  WHERE a.id = athlete_lesson_slots.athlete_id AND pp.user_id = auth.uid()
));
CREATE POLICY "Coaches view slots for rostered athletes"
ON public.athlete_lesson_slots FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.coach_profiles cp
  WHERE cp.id = athlete_lesson_slots.coach_id AND cp.user_id = auth.uid()
));

CREATE TRIGGER update_athlete_lesson_slots_updated_at
BEFORE UPDATE ON public.athlete_lesson_slots
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- athlete_invite_codes
CREATE TABLE public.athlete_invite_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_id UUID NOT NULL,
  athlete_id UUID NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (code ~ '^[A-Z2-9]{8}$')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.athlete_invite_codes TO authenticated;
GRANT ALL ON public.athlete_invite_codes TO service_role;

ALTER TABLE public.athlete_invite_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Parents manage own athlete invite codes - select"
ON public.athlete_invite_codes FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.parent_profiles pp
  WHERE pp.id = athlete_invite_codes.parent_id AND pp.user_id = auth.uid()
));
CREATE POLICY "Parents manage own athlete invite codes - insert"
ON public.athlete_invite_codes FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.parent_profiles pp
  WHERE pp.id = athlete_invite_codes.parent_id AND pp.user_id = auth.uid()
));
CREATE POLICY "Parents manage own athlete invite codes - update"
ON public.athlete_invite_codes FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.parent_profiles pp
  WHERE pp.id = athlete_invite_codes.parent_id AND pp.user_id = auth.uid()
));
CREATE POLICY "Parents manage own athlete invite codes - delete"
ON public.athlete_invite_codes FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.parent_profiles pp
  WHERE pp.id = athlete_invite_codes.parent_id AND pp.user_id = auth.uid()
));

CREATE TRIGGER update_athlete_invite_codes_updated_at
BEFORE UPDATE ON public.athlete_invite_codes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
