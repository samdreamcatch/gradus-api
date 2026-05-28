-- Plans authoring loop: moves library, plans, templates

CREATE TABLE public.seed_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport text NOT NULL,
  category text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  cue text NOT NULL DEFAULT '',
  why text NOT NULL DEFAULT '',
  default_target_kind text NOT NULL CHECK (default_target_kind IN ('reps','minutes')),
  default_target_value numeric NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.seed_moves TO service_role;
ALTER TABLE public.seed_moves ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  sport text NOT NULL,
  category text NOT NULL DEFAULT '',
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  cue text NOT NULL DEFAULT '',
  why text NOT NULL DEFAULT '',
  default_target_kind text NOT NULL DEFAULT 'reps' CHECK (default_target_kind IN ('reps','minutes')),
  default_target_value numeric NOT NULL DEFAULT 10,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_moves_coach ON public.moves(coach_id) WHERE archived_at IS NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.moves TO authenticated;
GRANT ALL ON public.moves TO service_role;
ALTER TABLE public.moves ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Coaches manage own moves - select" ON public.moves FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM coach_profiles cp WHERE cp.id = moves.coach_id AND cp.user_id = auth.uid()));
CREATE POLICY "Coaches manage own moves - insert" ON public.moves FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM coach_profiles cp WHERE cp.id = moves.coach_id AND cp.user_id = auth.uid()));
CREATE POLICY "Coaches manage own moves - update" ON public.moves FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM coach_profiles cp WHERE cp.id = moves.coach_id AND cp.user_id = auth.uid()));
CREATE POLICY "Coaches manage own moves - delete" ON public.moves FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM coach_profiles cp WHERE cp.id = moves.coach_id AND cp.user_id = auth.uid()));
CREATE TRIGGER trg_moves_updated_at BEFORE UPDATE ON public.moves
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('plan','template')),
  athlete_id uuid REFERENCES public.athletes(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','benched')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plans_kind_athlete_chk CHECK (
    (kind = 'plan' AND athlete_id IS NOT NULL) OR
    (kind = 'template' AND athlete_id IS NULL)
  )
);
CREATE INDEX idx_plans_coach ON public.plans(coach_id);
CREATE INDEX idx_plans_coach_athlete ON public.plans(coach_id, athlete_id) WHERE kind='plan';
CREATE UNIQUE INDEX one_active_plan_per_coach_athlete
  ON public.plans(coach_id, athlete_id)
  WHERE kind = 'plan' AND status = 'active';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plans TO authenticated;
GRANT ALL ON public.plans TO service_role;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Coaches manage own plans - select" ON public.plans FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM coach_profiles cp WHERE cp.id = plans.coach_id AND cp.user_id = auth.uid()));
CREATE POLICY "Coaches manage own plans - insert" ON public.plans FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM coach_profiles cp WHERE cp.id = plans.coach_id AND cp.user_id = auth.uid()));
CREATE POLICY "Coaches manage own plans - update" ON public.plans FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM coach_profiles cp WHERE cp.id = plans.coach_id AND cp.user_id = auth.uid()));
CREATE POLICY "Coaches manage own plans - delete" ON public.plans FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM coach_profiles cp WHERE cp.id = plans.coach_id AND cp.user_id = auth.uid()));
CREATE TRIGGER trg_plans_updated_at BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.plan_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  move_id uuid REFERENCES public.moves(id) ON DELETE SET NULL,
  position integer NOT NULL DEFAULT 0,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  cue text NOT NULL DEFAULT '',
  why text NOT NULL DEFAULT '',
  target_kind text NOT NULL CHECK (target_kind IN ('reps','minutes')),
  target_value numeric NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_plan_moves_plan ON public.plan_moves(plan_id, position);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_moves TO authenticated;
GRANT ALL ON public.plan_moves TO service_role;
ALTER TABLE public.plan_moves ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Coaches manage own plan_moves - select" ON public.plan_moves FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM plans p JOIN coach_profiles cp ON cp.id = p.coach_id
    WHERE p.id = plan_moves.plan_id AND cp.user_id = auth.uid()));
CREATE POLICY "Coaches manage own plan_moves - insert" ON public.plan_moves FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM plans p JOIN coach_profiles cp ON cp.id = p.coach_id
    WHERE p.id = plan_moves.plan_id AND cp.user_id = auth.uid()));
CREATE POLICY "Coaches manage own plan_moves - update" ON public.plan_moves FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM plans p JOIN coach_profiles cp ON cp.id = p.coach_id
    WHERE p.id = plan_moves.plan_id AND cp.user_id = auth.uid()));
CREATE POLICY "Coaches manage own plan_moves - delete" ON public.plan_moves FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM plans p JOIN coach_profiles cp ON cp.id = p.coach_id
    WHERE p.id = plan_moves.plan_id AND cp.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.seed_coach_library(_coach_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid;
  _inserted integer := 0;
BEGIN
  SELECT user_id INTO _user_id FROM coach_profiles WHERE id = _coach_id;
  IF _user_id IS NULL OR _user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF EXISTS (SELECT 1 FROM moves WHERE coach_id = _coach_id) THEN
    RETURN 0;
  END IF;
  INSERT INTO moves (coach_id, sport, category, name, description, cue, why,
                     default_target_kind, default_target_value)
  SELECT _coach_id, sm.sport, sm.category, sm.name, sm.description, sm.cue, sm.why,
         sm.default_target_kind, sm.default_target_value
  FROM seed_moves sm
  WHERE EXISTS (
    SELECT 1 FROM coach_levels cl
    WHERE cl.coach_id = _coach_id
      AND lower(cl.sport) = lower(sm.sport)
  );
  GET DIAGNOSTICS _inserted = ROW_COUNT;
  RETURN _inserted;
END;
$$;
GRANT EXECUTE ON FUNCTION public.seed_coach_library(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.activate_plan(_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _coach_id uuid;
  _athlete_id uuid;
  _user_id uuid;
BEGIN
  SELECT p.coach_id, p.athlete_id, cp.user_id
    INTO _coach_id, _athlete_id, _user_id
  FROM plans p JOIN coach_profiles cp ON cp.id = p.coach_id
  WHERE p.id = _plan_id AND p.kind = 'plan';
  IF _user_id IS NULL OR _user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE plans SET status='benched'
   WHERE coach_id=_coach_id AND athlete_id=_athlete_id
     AND kind='plan' AND status='active' AND id <> _plan_id;
  UPDATE plans SET status='active' WHERE id=_plan_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.activate_plan(uuid) TO authenticated;