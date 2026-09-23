-- Athlete skill events (PRD §6.7 "Athlete learning loop", milestone L1).
--
-- Nothing recorded when an athlete first attempted or first landed a skill,
-- so nothing could be learned about pace. Each row is one signal about one
-- skill for one athlete:
--   kind    attempted | landed | consistent | parked | dropped
--   source  coach     the coach's answer to the "why" prompt on bench/remove
--                     (landed it -> landed, parking it -> parked,
--                     changed direction -> dropped), confidence 1.0
--           protocol  a judged competition element: every executed element is
--                     `attempted`; a clean one (GOE >= 0, no < or * mark) is
--                     also `landed`. Figure skating only for now.
--           inferred  the nightly job in L3; confidence in (0, 1), shown to
--                     the coach as "likely", never promoted without a coach or
--                     protocol event
-- A skill is either a library move (`move_id`), a plan move with no library
-- link (`move_name` only), or a protocol element (`element_code`).
-- `move_category` is the move's library category or the element's family
-- (jump / spin / step / choreo / other); L3 groups pace by it.
--
-- Athletes and parents record nothing new (their session log stays a mood
-- measure, §7.6). Only the service role reads or writes this table: RLS is on
-- with no policies, and every writer (src/lib/skill-events.server.ts) runs
-- after the caller's ownership check, like athlete_goals_history.
CREATE TABLE IF NOT EXISTS public.athlete_skill_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  coach_id uuid REFERENCES public.coach_profiles(id) ON DELETE SET NULL,
  sport text NOT NULL DEFAULT '',
  kind text NOT NULL CHECK (kind IN ('attempted', 'landed', 'consistent', 'parked', 'dropped')),
  source text NOT NULL CHECK (source IN ('coach', 'protocol', 'inferred')),
  confidence numeric(3, 2) NOT NULL DEFAULT 1.0 CHECK (confidence > 0 AND confidence <= 1),
  move_id uuid REFERENCES public.moves(id) ON DELETE SET NULL,
  -- No FK: the plan move is usually deleted by the very action that records
  -- the event (a removal), and the id is kept only to relate events.
  plan_move_id uuid,
  plan_id uuid REFERENCES public.plans(id) ON DELETE SET NULL,
  competition_id uuid REFERENCES public.competitions(id) ON DELETE CASCADE,
  move_name text NOT NULL DEFAULT '',
  move_category text NOT NULL DEFAULT '',
  element_code text,
  -- Protocol events only: "<event name>|<segment>|<element index>", so
  -- re-linking a competition replaces its events instead of doubling them.
  element_ref text,
  -- What wrote the row: a bench answer, a move-removal answer, a linked
  -- protocol, or the inference job. The job treats only bench answers as the
  -- label for a whole plan (a removal answers for one move).
  origin text CHECK (origin IN ('bench', 'remove', 'protocol', 'inference')),
  -- When the skill entered practice, if known: the plan move's created_at for
  -- a coach answer. L3 measures pace from here rather than from the plan.
  started_at timestamptz,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS athlete_skill_events_athlete_idx
  ON public.athlete_skill_events (athlete_id, sport, occurred_at DESC);

CREATE INDEX IF NOT EXISTS athlete_skill_events_move_idx
  ON public.athlete_skill_events (athlete_id, move_id)
  WHERE move_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS athlete_skill_events_protocol_uniq
  ON public.athlete_skill_events (athlete_id, competition_id, element_ref, kind)
  WHERE source = 'protocol';

ALTER TABLE public.athlete_skill_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.athlete_skill_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.athlete_skill_events TO service_role;
