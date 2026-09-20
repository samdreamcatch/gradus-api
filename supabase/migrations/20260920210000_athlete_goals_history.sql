-- Goals history (Mariah, 2026-09-20): who set an athlete's goals, and what
-- they replaced.
--
-- athlete_goals is one row per (athlete, sport), last writer wins, with no
-- author column — so when an athlete changes the season target their parent
-- set, the parent's version is gone and the coach never learns the two
-- disagreed. This table keeps every tracked change with its author role
-- (parent or athlete) and the values it replaced. The coach's athlete detail
-- reads it to show "set by Nora on Sep 20" and, when the other person's
-- latest goals differ from what is saved now, both versions side by side
-- (src/lib/goals-history.server.ts).
--
-- Only the service role reads or writes it: RLS is on with no policies, and
-- both write paths (parent-settings.server.ts, adult-athlete.server.ts) and
-- the coach read (coach-athlete-detail.server.ts) use the admin client.
CREATE TABLE IF NOT EXISTS public.athlete_goals_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  sport text NOT NULL,
  changed_by_role text NOT NULL CHECK (changed_by_role IN ('parent', 'athlete')),
  changed_by_user_id uuid,
  current_level_key text NOT NULL,
  season_goal_key text NOT NULL,
  long_term_goal text NOT NULL DEFAULT '',
  previous_current_level_key text,
  previous_season_goal_key text,
  previous_long_term_goal text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS athlete_goals_history_athlete_sport_idx
  ON public.athlete_goals_history (athlete_id, sport, created_at DESC);

ALTER TABLE public.athlete_goals_history ENABLE ROW LEVEL SECURITY;

-- Backfill: every goal on file today becomes its first history row, attributed
-- to the athlete when the athlete owns the account (self_managed) and to the
-- parent otherwise — the only two authors the app has ever had. Dated from
-- the goal's last update so "set by" reads sensibly from day one.
INSERT INTO public.athlete_goals_history (
  athlete_id, sport, changed_by_role, changed_by_user_id,
  current_level_key, season_goal_key, long_term_goal, created_at
)
SELECT
  g.athlete_id,
  g.sport,
  CASE WHEN COALESCE(a.self_managed, false) THEN 'athlete' ELSE 'parent' END,
  NULL,
  g.current_level_key,
  g.season_goal_key,
  COALESCE(g.long_term_goal, ''),
  g.updated_at
FROM public.athlete_goals g
JOIN public.athletes a ON a.id = g.athlete_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.athlete_goals_history h
  WHERE h.athlete_id = g.athlete_id AND h.sport = g.sport
);
