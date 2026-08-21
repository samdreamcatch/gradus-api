-- 1) Rename the seat column (Family -> Team)
ALTER TABLE public.parent_profiles RENAME COLUMN family_plan_seats TO team_plan_seats;

CREATE OR REPLACE FUNCTION public.protect_parent_profile_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_privileged_writer() THEN
    RETURN NEW;
  END IF;
  NEW.user_id := OLD.user_id;
  NEW.coach_id := OLD.coach_id;
  NEW.promo_code := OLD.promo_code;
  NEW.is_test := OLD.is_test;
  NEW.stripe_customer_id := OLD.stripe_customer_id;
  NEW.stripe_subscription_id := OLD.stripe_subscription_id;
  NEW.subscription_status := OLD.subscription_status;
  NEW.current_period_end := OLD.current_period_end;
  NEW.subscription_environment := OLD.subscription_environment;
  NEW.team_plan_seats := OLD.team_plan_seats;
  RETURN NEW;
END;
$$;

-- 2) Parent's per-coach opt-in
CREATE TABLE public.athlete_coach_visibility (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  coach_id uuid NOT NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  enabled_by_parent_id uuid REFERENCES public.parent_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (athlete_id, coach_id)
);
CREATE INDEX idx_acv_athlete ON public.athlete_coach_visibility(athlete_id);
CREATE INDEX idx_acv_coach ON public.athlete_coach_visibility(coach_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.athlete_coach_visibility TO authenticated;
GRANT ALL ON public.athlete_coach_visibility TO service_role;
ALTER TABLE public.athlete_coach_visibility ENABLE ROW LEVEL SECURITY;

-- 3) Pairwise link with per-coach acceptance
CREATE TABLE public.coach_visibility_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  coach_a_id uuid NOT NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  coach_b_id uuid NOT NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  a_status text NOT NULL DEFAULT 'pending',
  b_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coach_visibility_links_status_a CHECK (a_status IN ('pending','accepted','declined')),
  CONSTRAINT coach_visibility_links_status_b CHECK (b_status IN ('pending','accepted','declined')),
  CONSTRAINT coach_visibility_links_ordered CHECK (coach_a_id < coach_b_id),
  UNIQUE (athlete_id, coach_a_id, coach_b_id)
);
CREATE INDEX idx_cvl_athlete ON public.coach_visibility_links(athlete_id);
CREATE INDEX idx_cvl_coach_a ON public.coach_visibility_links(coach_a_id);
CREATE INDEX idx_cvl_coach_b ON public.coach_visibility_links(coach_b_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_visibility_links TO authenticated;
GRANT ALL ON public.coach_visibility_links TO service_role;
ALTER TABLE public.coach_visibility_links ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER coach_visibility_links_updated_at
BEFORE UPDATE ON public.coach_visibility_links
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) Helpers
CREATE OR REPLACE FUNCTION public.my_coach_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.coach_profiles WHERE user_id = (SELECT auth.uid()) LIMIT 1;
$$;

-- True when the calling coach and _owner_coach_id hold an accepted, still
-- parent-enabled visibility link for this athlete.
CREATE OR REPLACE FUNCTION public.coaches_linked_for_athlete(
  _viewer_coach_id uuid,
  _owner_coach_id uuid,
  _athlete_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.coach_visibility_links l
    WHERE l.athlete_id = _athlete_id
      AND l.a_status = 'accepted'
      AND l.b_status = 'accepted'
      AND ((l.coach_a_id = _viewer_coach_id AND l.coach_b_id = _owner_coach_id)
        OR (l.coach_b_id = _viewer_coach_id AND l.coach_a_id = _owner_coach_id))
      AND EXISTS (SELECT 1 FROM public.athlete_coach_visibility v
                  WHERE v.athlete_id = _athlete_id AND v.coach_id = _viewer_coach_id)
      AND EXISTS (SELECT 1 FROM public.athlete_coach_visibility v
                  WHERE v.athlete_id = _athlete_id AND v.coach_id = _owner_coach_id)
  );
$$;

-- Convenience wrappers used by policies (resolve the caller's coach id).
CREATE OR REPLACE FUNCTION public.can_view_shared_coach_plan(_owner_coach_id uuid, _athlete_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _owner_coach_id IS NOT NULL
     AND _athlete_id IS NOT NULL
     AND public.coaches_linked_for_athlete(public.my_coach_id(), _owner_coach_id, _athlete_id);
$$;

-- True when the calling coach has any accepted link for this athlete.
CREATE OR REPLACE FUNCTION public.shares_athlete_window(_athlete_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.coach_visibility_links l
    WHERE l.athlete_id = _athlete_id
      AND l.a_status = 'accepted'
      AND l.b_status = 'accepted'
      AND (l.coach_a_id = public.my_coach_id() OR l.coach_b_id = public.my_coach_id())
  );
$$;

-- 5) RLS on the new tables
CREATE POLICY "Parents manage coach visibility for their athletes"
  ON public.athlete_coach_visibility FOR ALL TO authenticated
  USING (athlete_id IN (SELECT public.parent_athlete_ids()))
  WITH CHECK (athlete_id IN (SELECT public.parent_athlete_ids()));

CREATE POLICY "Coaches see their own visibility opt-ins"
  ON public.athlete_coach_visibility FOR SELECT TO authenticated
  USING (coach_id = public.my_coach_id());

CREATE POLICY "Parents manage visibility links for their athletes"
  ON public.coach_visibility_links FOR ALL TO authenticated
  USING (athlete_id IN (SELECT public.parent_athlete_ids()))
  WITH CHECK (athlete_id IN (SELECT public.parent_athlete_ids()));

CREATE POLICY "Coaches read links naming them"
  ON public.coach_visibility_links FOR SELECT TO authenticated
  USING (coach_a_id = public.my_coach_id() OR coach_b_id = public.my_coach_id());

CREATE POLICY "Coaches respond to links naming them"
  ON public.coach_visibility_links FOR UPDATE TO authenticated
  USING (coach_a_id = public.my_coach_id() OR coach_b_id = public.my_coach_id())
  WITH CHECK (coach_a_id = public.my_coach_id() OR coach_b_id = public.my_coach_id());

-- 6) Additive read access for linked coaches
CREATE POLICY "Linked coaches view shared plans"
  ON public.plans FOR SELECT TO authenticated
  USING (public.can_view_shared_coach_plan(coach_id, athlete_id));

CREATE POLICY "Linked coaches view shared plan moves"
  ON public.plan_moves FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.plans p
    WHERE p.id = plan_moves.plan_id
      AND public.can_view_shared_coach_plan(p.coach_id, p.athlete_id)
  ));

CREATE POLICY "Linked coaches view shared practice log"
  ON public.plan_sessions FOR SELECT TO authenticated
  USING (public.shares_athlete_window(athlete_id));

CREATE POLICY "Linked coaches view shared goals"
  ON public.athlete_goals FOR SELECT TO authenticated
  USING (public.shares_athlete_window(athlete_id));

CREATE POLICY "Linked coaches view shared schedule"
  ON public.athlete_lesson_slots FOR SELECT TO authenticated
  USING (public.shares_athlete_window(athlete_id));