ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS feedback_scope text NOT NULL DEFAULT 'plan';
ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_feedback_scope_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_feedback_scope_check CHECK (feedback_scope IN ('plan', 'moves'));

ALTER TABLE public.plan_sessions
  ADD COLUMN IF NOT EXISTS feedback_scope text NOT NULL DEFAULT 'plan';
ALTER TABLE public.plan_sessions DROP CONSTRAINT IF EXISTS plan_sessions_feedback_scope_check;
ALTER TABLE public.plan_sessions
  ADD CONSTRAINT plan_sessions_feedback_scope_check CHECK (feedback_scope IN ('plan', 'moves'));

CREATE TABLE IF NOT EXISTS public.plan_session_move_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.plan_sessions(id) ON DELETE CASCADE,
  plan_move_id uuid REFERENCES public.plan_moves(id) ON DELETE SET NULL,
  move_id uuid REFERENCES public.moves(id) ON DELETE SET NULL,
  move_name text NOT NULL,
  position integer NOT NULL,
  state_index smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_session_move_ratings_state_index_range CHECK (state_index BETWEEN 0 AND 4),
  CONSTRAINT plan_session_move_ratings_one_per_move UNIQUE (session_id, plan_move_id)
);
CREATE INDEX IF NOT EXISTS plan_session_move_ratings_session_idx
  ON public.plan_session_move_ratings (session_id);
CREATE INDEX IF NOT EXISTS plan_session_move_ratings_plan_move_idx
  ON public.plan_session_move_ratings (plan_move_id);
CREATE INDEX IF NOT EXISTS plan_session_move_ratings_move_idx
  ON public.plan_session_move_ratings (move_id);

GRANT SELECT, INSERT ON public.plan_session_move_ratings TO authenticated;
GRANT ALL ON public.plan_session_move_ratings TO service_role;
ALTER TABLE public.plan_session_move_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View ratings for viewable sessions" ON public.plan_session_move_ratings;
CREATE POLICY "View ratings for viewable sessions"
  ON public.plan_session_move_ratings FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.plan_sessions s WHERE s.id = plan_session_move_ratings.session_id)
  );

DROP POLICY IF EXISTS "Loggers insert ratings for own sessions" ON public.plan_session_move_ratings;
CREATE POLICY "Loggers insert ratings for own sessions"
  ON public.plan_session_move_ratings FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.plan_sessions s
      LEFT JOIN public.parent_profiles pp ON pp.id = s.parent_id
      LEFT JOIN public.athletes a ON a.id = s.athlete_id
      WHERE s.id = plan_session_move_ratings.session_id
        AND (
          (s.parent_id IS NOT NULL AND pp.user_id = auth.uid())
          OR (s.parent_id IS NULL AND a.user_id = auth.uid())
        )
    )
  );

CREATE OR REPLACE FUNCTION public.log_plan_session(
  _plan_id uuid,
  _athlete_id uuid,
  _parent_id uuid,
  _state_index smallint,
  _note text,
  _duration_seconds integer,
  _move_ratings jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  rating_count integer := COALESCE(jsonb_array_length(_move_ratings), 0);
  known_count integer;
  avg_rating numeric;
  overall smallint;
  new_id uuid;
BEGIN
  IF rating_count = 0 THEN
    IF _state_index IS NULL THEN
      RAISE EXCEPTION 'A whole-plan check-in needs a rating' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.plan_sessions (plan_id, athlete_id, parent_id, state_index, note, duration_seconds, feedback_scope)
    VALUES (_plan_id, _athlete_id, _parent_id, _state_index, COALESCE(_note, ''), COALESCE(_duration_seconds, 0), 'plan')
    RETURNING id INTO new_id;
    RETURN new_id;
  END IF;

  SELECT count(DISTINCT pm.id)
    INTO known_count
    FROM jsonb_to_recordset(_move_ratings) AS r("planMoveId" uuid, "stateIndex" smallint)
    JOIN public.plan_moves pm ON pm.id = r."planMoveId" AND pm.plan_id = _plan_id;
  IF known_count <> rating_count THEN
    RAISE EXCEPTION 'A rated move is not on this plan' USING ERRCODE = '22023';
  END IF;

  SELECT avg(r."stateIndex")
    INTO avg_rating
    FROM jsonb_to_recordset(_move_ratings) AS r("planMoveId" uuid, "stateIndex" smallint);
  overall := CASE WHEN avg_rating < 2 THEN floor(avg_rating + 0.5) ELSE ceil(avg_rating - 0.5) END;

  INSERT INTO public.plan_sessions (plan_id, athlete_id, parent_id, state_index, note, duration_seconds, feedback_scope)
  VALUES (_plan_id, _athlete_id, _parent_id, overall, COALESCE(_note, ''), COALESCE(_duration_seconds, 0), 'moves')
  RETURNING id INTO new_id;

  INSERT INTO public.plan_session_move_ratings (session_id, plan_move_id, move_id, move_name, position, state_index)
  SELECT new_id, pm.id, pm.move_id, pm.name, pm.position, r."stateIndex"
    FROM jsonb_to_recordset(_move_ratings) AS r("planMoveId" uuid, "stateIndex" smallint)
    JOIN public.plan_moves pm ON pm.id = r."planMoveId" AND pm.plan_id = _plan_id;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_plan_session(uuid, uuid, uuid, smallint, text, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_plan_session(uuid, uuid, uuid, smallint, text, integer, jsonb) TO authenticated, service_role;