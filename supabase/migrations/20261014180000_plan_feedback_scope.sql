-- Feedback on each move, or on the whole plan (Mariah, 2026-10-14).
--
-- A coach chooses per plan whether the athlete or parent rates every move
-- after practice, or the plan as a whole (never both; whole plan is the
-- default). A session still carries one overall state_index: for an each-move
-- check-in it is the average of the moves that were rated, so every existing
-- reader (FlowBars, the practice chart, AI summaries) keeps working unchanged.
-- A move can be left unrated; it has no row and stays out of the average.

-- 1. The coach's choice. Copies of a plan (fork, template use) carry it.
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS feedback_scope text NOT NULL DEFAULT 'plan';
ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_feedback_scope_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_feedback_scope_check CHECK (feedback_scope IN ('plan', 'moves'));

-- 2. What this session was rated on. The coach can switch the plan later, so
-- each session records its own. Older app builds only send an overall rating;
-- those sessions are 'plan' whatever the plan says.
ALTER TABLE public.plan_sessions
  ADD COLUMN IF NOT EXISTS feedback_scope text NOT NULL DEFAULT 'plan';
ALTER TABLE public.plan_sessions DROP CONSTRAINT IF EXISTS plan_sessions_feedback_scope_check;
ALTER TABLE public.plan_sessions
  ADD CONSTRAINT plan_sessions_feedback_scope_check CHECK (feedback_scope IN ('plan', 'moves'));

-- 3. One row per rated move. move_name and position are copied at logging
-- time so the history still reads right after a move is renamed or removed;
-- move_id is the library move, to follow one move across plans.
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

-- Auth-only, like plan_sessions. Rows go away with their session (the FK
-- cascade), so there is no DELETE grant or policy.
GRANT SELECT, INSERT ON public.plan_session_move_ratings TO authenticated;
GRANT ALL ON public.plan_session_move_ratings TO service_role;
ALTER TABLE public.plan_session_move_ratings ENABLE ROW LEVEL SECURITY;

-- Read: whoever may read the session may read its ratings. The subquery runs
-- under plan_sessions' own RLS, so this follows those policies exactly.
DROP POLICY IF EXISTS "View ratings for viewable sessions" ON public.plan_session_move_ratings;
CREATE POLICY "View ratings for viewable sessions"
  ON public.plan_session_move_ratings FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.plan_sessions s WHERE s.id = plan_session_move_ratings.session_id)
  );

-- Write: only the person who logged the session (the parent who logged it, or
-- the athlete logging for themselves).
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

-- 4. Log a session and its move ratings in one transaction. SECURITY INVOKER:
-- every insert is checked by the caller's own RLS policies, exactly as the
-- direct insert it replaces.
--
-- _move_ratings is a JSON array of {"planMoveId": uuid, "stateIndex": 0-4}.
-- Empty or null: a whole-plan check-in, and _state_index is required.
-- Otherwise: an each-move check-in. _state_index is ignored and set to the
-- average of the ratings, rounded to the nearest point with a tie rounding
-- toward the middle point (2, "Just right").
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

  -- Every rated move must be on this plan, once.
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
