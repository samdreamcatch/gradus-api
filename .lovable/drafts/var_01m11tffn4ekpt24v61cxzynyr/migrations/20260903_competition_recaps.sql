-- Competition recap prompt.
--
-- When a signed-in parent or athlete opens a live board at a competition we
-- remember the visit, then ask them once the competition is over how it went.
-- The recap lives on the athlete's record and is also sent to their coach.

/* ------------------------------------------------------- board attendance */

CREATE TABLE IF NOT EXISTS public.competition_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  athlete_id uuid REFERENCES public.athletes(id) ON DELETE SET NULL,
  skater_name text NOT NULL DEFAULT '',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  recap_done_at timestamptz,
  UNIQUE (user_id, competition_id)
);

CREATE INDEX IF NOT EXISTS competition_attendance_user_idx
  ON public.competition_attendance (user_id, first_seen_at DESC);

-- No anon: a signed-out board viewer records nothing.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.competition_attendance TO authenticated;
GRANT ALL ON public.competition_attendance TO service_role;

ALTER TABLE public.competition_attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own attendance rows"
  ON public.competition_attendance FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

/* ------------------------------------------------------------- the recap */

CREATE TABLE IF NOT EXISTS public.competition_recaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL,
  author_role text NOT NULL CHECK (author_role IN ('parent', 'athlete')),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competition_id, athlete_id, author_user_id)
);

CREATE INDEX IF NOT EXISTS competition_recaps_athlete_idx
  ON public.competition_recaps (athlete_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.competition_recaps TO authenticated;
GRANT ALL ON public.competition_recaps TO service_role;

ALTER TABLE public.competition_recaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Athlete circle can read competition recaps"
  ON public.competition_recaps FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.coach_athletes ca
      WHERE ca.athlete_id = competition_recaps.athlete_id
        AND ca.coach_id = public.my_coach_id()
    )
    OR public.guardian_can_write_athlete(athlete_id)
    OR public.parent_can_write(athlete_id)
    OR public.is_self_managed_athlete(athlete_id)
  );

CREATE POLICY "Author in the athlete circle can write a recap"
  ON public.competition_recaps FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = author_user_id
    AND (
      public.guardian_can_write_athlete(athlete_id)
      OR public.parent_can_write(athlete_id)
      OR public.is_self_managed_athlete(athlete_id)
    )
  );

CREATE POLICY "Author can revise their own recap"
  ON public.competition_recaps FOR UPDATE
  TO authenticated
  USING (auth.uid() = author_user_id)
  WITH CHECK (
    auth.uid() = author_user_id
    AND (
      public.guardian_can_write_athlete(athlete_id)
      OR public.parent_can_write(athlete_id)
      OR public.is_self_managed_athlete(athlete_id)
    )
  );
