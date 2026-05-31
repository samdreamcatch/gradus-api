-- Stores one row per practice session logged by a parent for a plan.
CREATE TABLE public.plan_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL,
  athlete_id uuid NOT NULL,
  parent_id uuid NOT NULL,
  state_index smallint NOT NULL,
  note text NOT NULL DEFAULT '',
  duration_seconds integer NOT NULL DEFAULT 0,
  logged_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_sessions_state_index_range CHECK (state_index BETWEEN 0 AND 4),
  CONSTRAINT plan_sessions_duration_nonneg CHECK (duration_seconds >= 0)
);

CREATE INDEX plan_sessions_plan_id_logged_at_idx
  ON public.plan_sessions (plan_id, logged_at DESC);

-- Auth-only table: every policy scopes to auth.uid(); no anon grant.
GRANT SELECT, INSERT, DELETE ON public.plan_sessions TO authenticated;
GRANT ALL ON public.plan_sessions TO service_role;

ALTER TABLE public.plan_sessions ENABLE ROW LEVEL SECURITY;

-- Parents: full visibility + write for their own athletes' plans.
CREATE POLICY "Parents view sessions for own athletes"
  ON public.plan_sessions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.athletes a
      JOIN public.parent_profiles pp ON pp.id = a.parent_id
      WHERE a.id = plan_sessions.athlete_id
        AND pp.user_id = auth.uid()
    )
  );

CREATE POLICY "Parents insert sessions for own athletes"
  ON public.plan_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.parent_profiles pp
      WHERE pp.id = plan_sessions.parent_id
        AND pp.user_id = auth.uid()
    )
    AND public.is_parent_of_athlete(plan_sessions.athlete_id)
    AND public.is_parent_of_plan(plan_sessions.plan_id)
  );

CREATE POLICY "Parents delete sessions for own athletes"
  ON public.plan_sessions
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.parent_profiles pp
      WHERE pp.id = plan_sessions.parent_id
        AND pp.user_id = auth.uid()
    )
  );

-- Coaches: read-only access to sessions for plans they own.
CREATE POLICY "Coaches view sessions for own plans"
  ON public.plan_sessions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.plans p
      JOIN public.coach_profiles cp ON cp.id = p.coach_id
      WHERE p.id = plan_sessions.plan_id
        AND cp.user_id = auth.uid()
    )
  );