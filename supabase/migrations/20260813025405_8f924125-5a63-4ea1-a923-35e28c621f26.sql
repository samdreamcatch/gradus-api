CREATE OR REPLACE FUNCTION public.athlete_can_self_connect(_athlete_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.athletes a
    WHERE a.id = _athlete_id
      AND a.user_id = auth.uid()
  );
$function$;

-- coach_athletes
DROP POLICY IF EXISTS "Self-managed athletes view own coach links" ON public.coach_athletes;
CREATE POLICY "Self-managed athletes view own coach links"
  ON public.coach_athletes FOR SELECT
  USING (public.athlete_can_self_connect(athlete_id));

DROP POLICY IF EXISTS "Self-managed athletes insert own coach links" ON public.coach_athletes;
CREATE POLICY "Self-managed athletes insert own coach links"
  ON public.coach_athletes FOR INSERT
  WITH CHECK (public.athlete_can_self_connect(athlete_id));

DROP POLICY IF EXISTS "Self-managed athletes delete own coach links" ON public.coach_athletes;
CREATE POLICY "Self-managed athletes delete own coach links"
  ON public.coach_athletes FOR DELETE
  USING (public.athlete_can_self_connect(athlete_id));

-- coach_athlete_sports
DROP POLICY IF EXISTS "Self-managed athletes view own coach sports" ON public.coach_athlete_sports;
CREATE POLICY "Self-managed athletes view own coach sports"
  ON public.coach_athlete_sports FOR SELECT
  USING (public.athlete_can_self_connect(athlete_id));

DROP POLICY IF EXISTS "Self-managed athletes insert own coach sports" ON public.coach_athlete_sports;
CREATE POLICY "Self-managed athletes insert own coach sports"
  ON public.coach_athlete_sports FOR INSERT
  WITH CHECK (public.athlete_can_self_connect(athlete_id));

DROP POLICY IF EXISTS "Self-managed athletes delete own coach sports" ON public.coach_athlete_sports;
CREATE POLICY "Self-managed athletes delete own coach sports"
  ON public.coach_athlete_sports FOR DELETE
  USING (public.athlete_can_self_connect(athlete_id));

-- athlete_primary_coaches
DROP POLICY IF EXISTS "Self-managed athletes manage primary coach - select" ON public.athlete_primary_coaches;
CREATE POLICY "Self-managed athletes manage primary coach - select"
  ON public.athlete_primary_coaches FOR SELECT
  USING (public.athlete_can_self_connect(athlete_id));

DROP POLICY IF EXISTS "Self-managed athletes manage primary coach - insert" ON public.athlete_primary_coaches;
CREATE POLICY "Self-managed athletes manage primary coach - insert"
  ON public.athlete_primary_coaches FOR INSERT
  WITH CHECK (public.athlete_can_self_connect(athlete_id));

DROP POLICY IF EXISTS "Self-managed athletes manage primary coach - update" ON public.athlete_primary_coaches;
CREATE POLICY "Self-managed athletes manage primary coach - update"
  ON public.athlete_primary_coaches FOR UPDATE
  USING (public.athlete_can_self_connect(athlete_id))
  WITH CHECK (public.athlete_can_self_connect(athlete_id));

DROP POLICY IF EXISTS "Self-managed athletes manage primary coach - delete" ON public.athlete_primary_coaches;
CREATE POLICY "Self-managed athletes manage primary coach - delete"
  ON public.athlete_primary_coaches FOR DELETE
  USING (public.athlete_can_self_connect(athlete_id));

-- athlete_goals
DROP POLICY IF EXISTS "Self-managed athletes manage own goals - select" ON public.athlete_goals;
CREATE POLICY "Self-managed athletes manage own goals - select"
  ON public.athlete_goals FOR SELECT
  USING (public.athlete_can_self_connect(athlete_id));

DROP POLICY IF EXISTS "Self-managed athletes manage own goals - insert" ON public.athlete_goals;
CREATE POLICY "Self-managed athletes manage own goals - insert"
  ON public.athlete_goals FOR INSERT
  WITH CHECK (public.athlete_can_self_connect(athlete_id));

DROP POLICY IF EXISTS "Self-managed athletes manage own goals - update" ON public.athlete_goals;
CREATE POLICY "Self-managed athletes manage own goals - update"
  ON public.athlete_goals FOR UPDATE
  USING (public.athlete_can_self_connect(athlete_id))
  WITH CHECK (public.athlete_can_self_connect(athlete_id));

DROP POLICY IF EXISTS "Self-managed athletes manage own goals - delete" ON public.athlete_goals;
CREATE POLICY "Self-managed athletes manage own goals - delete"
  ON public.athlete_goals FOR DELETE
  USING (public.athlete_can_self_connect(athlete_id));