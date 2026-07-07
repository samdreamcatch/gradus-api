-- 1. Schema: allow self-managed adult athletes
ALTER TABLE public.athletes
  ALTER COLUMN parent_id DROP NOT NULL;

ALTER TABLE public.athletes
  ADD COLUMN IF NOT EXISTS self_managed boolean NOT NULL DEFAULT false;

-- Structural invariants: exactly one owner model per row.
ALTER TABLE public.athletes
  ADD CONSTRAINT athletes_self_managed_shape
    CHECK (
      (self_managed = false AND parent_id IS NOT NULL)
      OR
      (self_managed = true  AND parent_id IS NULL AND birthdate IS NOT NULL)
    );

-- Age gate: enforced at the DB so a tampered client cannot create an
-- underage self-managed account.
CREATE OR REPLACE FUNCTION public.enforce_adult_self_managed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.self_managed IS TRUE THEN
    IF NEW.birthdate IS NULL THEN
      RAISE EXCEPTION 'Self-managed athletes require a birthdate';
    END IF;
    IF (NEW.birthdate + INTERVAL '18 years') > now() THEN
      RAISE EXCEPTION 'Self-managed athletes must be at least 18 years old'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_adult_self_managed ON public.athletes;
CREATE TRIGGER enforce_adult_self_managed
  BEFORE INSERT OR UPDATE OF self_managed, birthdate ON public.athletes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_adult_self_managed();

-- Partial index for admin listings of adult accounts.
CREATE INDEX IF NOT EXISTS idx_athletes_self_managed
  ON public.athletes (id) WHERE self_managed = true;

-- 2. Helper: is the caller the self-managed athlete themselves?
--    Mirrors the shape of is_parent_of_athlete for symmetry. SECURITY DEFINER
--    so RLS on athletes doesn't recurse.
CREATE OR REPLACE FUNCTION public.is_self_managed_athlete(_athlete_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.athletes a
    WHERE a.id = _athlete_id
      AND a.self_managed = true
      AND a.user_id = auth.uid()
  );
$$;

-- 3. RLS: adult-athlete branches. All are additive OR-branches to today's
--    parent policies; under-18 athletes never match self_managed = true.

-- athletes: allow an adult to create their own row.
DROP POLICY IF EXISTS "Adults can insert own self-managed athlete row" ON public.athletes;
CREATE POLICY "Adults can insert own self-managed athlete row"
  ON public.athletes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    self_managed = true
    AND parent_id IS NULL
    AND user_id = auth.uid()
  );

-- athlete_goals: adult athlete manages own goals.
DROP POLICY IF EXISTS "Self-managed athletes manage own goals - select" ON public.athlete_goals;
CREATE POLICY "Self-managed athletes manage own goals - select"
  ON public.athlete_goals FOR SELECT TO authenticated
  USING (public.is_self_managed_athlete(athlete_id));

DROP POLICY IF EXISTS "Self-managed athletes manage own goals - insert" ON public.athlete_goals;
CREATE POLICY "Self-managed athletes manage own goals - insert"
  ON public.athlete_goals FOR INSERT TO authenticated
  WITH CHECK (public.is_self_managed_athlete(athlete_id));

DROP POLICY IF EXISTS "Self-managed athletes manage own goals - update" ON public.athlete_goals;
CREATE POLICY "Self-managed athletes manage own goals - update"
  ON public.athlete_goals FOR UPDATE TO authenticated
  USING (public.is_self_managed_athlete(athlete_id))
  WITH CHECK (public.is_self_managed_athlete(athlete_id));

DROP POLICY IF EXISTS "Self-managed athletes manage own goals - delete" ON public.athlete_goals;
CREATE POLICY "Self-managed athletes manage own goals - delete"
  ON public.athlete_goals FOR DELETE TO authenticated
  USING (public.is_self_managed_athlete(athlete_id));

-- athlete_primary_coaches: adult athlete manages own primary coach.
DROP POLICY IF EXISTS "Self-managed athletes manage primary coach - select" ON public.athlete_primary_coaches;
CREATE POLICY "Self-managed athletes manage primary coach - select"
  ON public.athlete_primary_coaches FOR SELECT TO authenticated
  USING (public.is_self_managed_athlete(athlete_id));

DROP POLICY IF EXISTS "Self-managed athletes manage primary coach - insert" ON public.athlete_primary_coaches;
CREATE POLICY "Self-managed athletes manage primary coach - insert"
  ON public.athlete_primary_coaches FOR INSERT TO authenticated
  WITH CHECK (public.is_self_managed_athlete(athlete_id));

DROP POLICY IF EXISTS "Self-managed athletes manage primary coach - update" ON public.athlete_primary_coaches;
CREATE POLICY "Self-managed athletes manage primary coach - update"
  ON public.athlete_primary_coaches FOR UPDATE TO authenticated
  USING (public.is_self_managed_athlete(athlete_id))
  WITH CHECK (public.is_self_managed_athlete(athlete_id));

DROP POLICY IF EXISTS "Self-managed athletes manage primary coach - delete" ON public.athlete_primary_coaches;
CREATE POLICY "Self-managed athletes manage primary coach - delete"
  ON public.athlete_primary_coaches FOR DELETE TO authenticated
  USING (public.is_self_managed_athlete(athlete_id));

-- coach_athletes: adult athlete claims/removes own coach link.
DROP POLICY IF EXISTS "Self-managed athletes view own coach links" ON public.coach_athletes;
CREATE POLICY "Self-managed athletes view own coach links"
  ON public.coach_athletes FOR SELECT TO authenticated
  USING (public.is_self_managed_athlete(athlete_id));

DROP POLICY IF EXISTS "Self-managed athletes insert own coach links" ON public.coach_athletes;
CREATE POLICY "Self-managed athletes insert own coach links"
  ON public.coach_athletes FOR INSERT TO authenticated
  WITH CHECK (public.is_self_managed_athlete(athlete_id));

DROP POLICY IF EXISTS "Self-managed athletes delete own coach links" ON public.coach_athletes;
CREATE POLICY "Self-managed athletes delete own coach links"
  ON public.coach_athletes FOR DELETE TO authenticated
  USING (public.is_self_managed_athlete(athlete_id));

-- coach_athlete_sports: adult athlete manages own coach-sport preferences.
DROP POLICY IF EXISTS "Self-managed athletes view own coach sports" ON public.coach_athlete_sports;
CREATE POLICY "Self-managed athletes view own coach sports"
  ON public.coach_athlete_sports FOR SELECT TO authenticated
  USING (public.is_self_managed_athlete(athlete_id));

DROP POLICY IF EXISTS "Self-managed athletes insert own coach sports" ON public.coach_athlete_sports;
CREATE POLICY "Self-managed athletes insert own coach sports"
  ON public.coach_athlete_sports FOR INSERT TO authenticated
  WITH CHECK (public.is_self_managed_athlete(athlete_id));

DROP POLICY IF EXISTS "Self-managed athletes delete own coach sports" ON public.coach_athlete_sports;
CREATE POLICY "Self-managed athletes delete own coach sports"
  ON public.coach_athlete_sports FOR DELETE TO authenticated
  USING (public.is_self_managed_athlete(athlete_id));