-- Competition results → draft practice plan.
--
-- A coach links an athlete already on their roster to a skater in a finished
-- competition. Only linked athletes get durable score rows; everyone else stays
-- in the ephemeral board snapshot.

-- Cached skater name index per competition, so matching does not re-scrape the
-- whole event list on every open. Additive column on the existing snapshot row.
ALTER TABLE public.competition_snapshots
  ADD COLUMN IF NOT EXISTS skater_index jsonb NOT NULL DEFAULT '{}'::jsonb;

/* ------------------------------------------------------------- the link */

CREATE TABLE IF NOT EXISTS public.athlete_competition_skaters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  skater_name text NOT NULL,
  club text NOT NULL DEFAULT '',
  ijs_key text,
  linked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (athlete_id, competition_id)
);

CREATE INDEX IF NOT EXISTS athlete_competition_skaters_comp_idx
  ON public.athlete_competition_skaters (competition_id);

-- No anon: a signed-out board viewer must not read or write either table.
GRANT SELECT, INSERT, DELETE ON public.athlete_competition_skaters TO authenticated;
GRANT ALL ON public.athlete_competition_skaters TO service_role;

ALTER TABLE public.athlete_competition_skaters ENABLE ROW LEVEL SECURITY;

-- The rostered coach may create and remove the link.
CREATE POLICY "Rostered coach can link an athlete to a skater"
  ON public.athlete_competition_skaters FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.coach_athletes ca
      WHERE ca.athlete_id = athlete_competition_skaters.athlete_id
        AND ca.coach_id = public.my_coach_id()
    )
  );

CREATE POLICY "Athlete circle can remove a competition link"
  ON public.athlete_competition_skaters FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.coach_athletes ca
      WHERE ca.athlete_id = athlete_competition_skaters.athlete_id
        AND ca.coach_id = public.my_coach_id()
    )
    OR public.guardian_can_write_athlete(athlete_id)
    OR public.parent_can_write(athlete_id)
    OR public.is_self_managed_athlete(athlete_id)
  );

CREATE POLICY "Athlete circle can read competition links"
  ON public.athlete_competition_skaters FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.coach_athletes ca
      WHERE ca.athlete_id = athlete_competition_skaters.athlete_id
        AND ca.coach_id = public.my_coach_id()
    )
    OR public.guardian_can_write_athlete(athlete_id)
    OR public.parent_can_write(athlete_id)
    OR public.is_self_managed_athlete(athlete_id)
  );

/* ---------------------------------------------------------- score history */

CREATE TABLE IF NOT EXISTS public.athlete_competition_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  segment text NOT NULL DEFAULT '',
  rink text NOT NULL DEFAULT '',
  event_file text NOT NULL DEFAULT '',
  start_order integer,
  placement text NOT NULL DEFAULT '',
  segment_score text NOT NULL DEFAULT '',
  total_score text NOT NULL DEFAULT '',
  protocol jsonb,
  skated_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (athlete_id, competition_id, event_name, segment)
);

CREATE INDEX IF NOT EXISTS athlete_competition_results_athlete_idx
  ON public.athlete_competition_results (athlete_id, created_at DESC);

-- Reads only for the athlete's circle; every write comes from the server.
GRANT SELECT ON public.athlete_competition_results TO authenticated;
GRANT ALL ON public.athlete_competition_results TO service_role;

ALTER TABLE public.athlete_competition_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Athlete circle can read competition results"
  ON public.athlete_competition_results FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.coach_athletes ca
      WHERE ca.athlete_id = athlete_competition_results.athlete_id
        AND ca.coach_id = public.my_coach_id()
    )
    OR public.guardian_can_write_athlete(athlete_id)
    OR public.parent_can_write(athlete_id)
    OR public.is_self_managed_athlete(athlete_id)
  );

/* -------------------------------------------- plans sourced from a comp */

ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_source_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_source_check CHECK (source IN ('coach', 'gradus', 'competition'));
