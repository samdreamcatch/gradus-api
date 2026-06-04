
-- 1. New table: athlete_primary_coaches
CREATE TABLE public.athlete_primary_coaches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  sport text NOT NULL,
  coach_id uuid NOT NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (athlete_id, sport)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.athlete_primary_coaches TO authenticated;
GRANT ALL ON public.athlete_primary_coaches TO service_role;

ALTER TABLE public.athlete_primary_coaches ENABLE ROW LEVEL SECURITY;

-- Parents own primary-coach selection for their athletes
CREATE POLICY "Parents manage primary coach - select"
  ON public.athlete_primary_coaches FOR SELECT TO authenticated
  USING (public.is_parent_of_athlete(athlete_id));

CREATE POLICY "Parents manage primary coach - insert"
  ON public.athlete_primary_coaches FOR INSERT TO authenticated
  WITH CHECK (public.is_parent_of_athlete(athlete_id));

CREATE POLICY "Parents manage primary coach - update"
  ON public.athlete_primary_coaches FOR UPDATE TO authenticated
  USING (public.is_parent_of_athlete(athlete_id))
  WITH CHECK (public.is_parent_of_athlete(athlete_id));

CREATE POLICY "Parents manage primary coach - delete"
  ON public.athlete_primary_coaches FOR DELETE TO authenticated
  USING (public.is_parent_of_athlete(athlete_id));

-- Any coach linked to the athlete can read who the primary is
CREATE POLICY "Coaches linked to athlete can view primary"
  ON public.athlete_primary_coaches FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.coach_profiles cp
      JOIN public.coach_athletes ca ON ca.coach_id = cp.id
      WHERE cp.user_id = auth.uid()
        AND ca.athlete_id = athlete_primary_coaches.athlete_id
    )
  );

-- Trigger: assert the chosen coach is linked to the athlete AND offers the sport
CREATE OR REPLACE FUNCTION public.validate_athlete_primary_coach()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.coach_athletes
    WHERE coach_id = NEW.coach_id AND athlete_id = NEW.athlete_id
  ) THEN
    RAISE EXCEPTION 'Coach is not linked to this athlete';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.coach_levels
    WHERE coach_id = NEW.coach_id AND sport = NEW.sport
  ) THEN
    RAISE EXCEPTION 'Coach does not offer this sport';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_athlete_primary_coach
  BEFORE INSERT OR UPDATE ON public.athlete_primary_coaches
  FOR EACH ROW EXECUTE FUNCTION public.validate_athlete_primary_coach();

CREATE TRIGGER update_athlete_primary_coaches_updated_at
  BEFORE UPDATE ON public.athlete_primary_coaches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Backfill primary coaches from existing data.
-- For each (athlete, sport) where a coach is both linked and offers that sport,
-- pick the earliest-linked coach.
INSERT INTO public.athlete_primary_coaches (athlete_id, sport, coach_id)
SELECT DISTINCT ON (ca.athlete_id, cl.sport)
  ca.athlete_id, cl.sport, ca.coach_id
FROM public.coach_athletes ca
JOIN public.coach_levels cl ON cl.coach_id = ca.coach_id
ORDER BY ca.athlete_id, cl.sport, ca.created_at ASC, ca.id ASC
ON CONFLICT (athlete_id, sport) DO NOTHING;

-- 3. Reshape athlete_goals uniqueness
ALTER TABLE public.athlete_goals
  DROP CONSTRAINT IF EXISTS athlete_goals_athlete_id_coach_id_sport_key;

-- Safety: collapse any accidental duplicates per (athlete, sport), keep most recent
DELETE FROM public.athlete_goals a
USING public.athlete_goals b
WHERE a.athlete_id = b.athlete_id
  AND a.sport = b.sport
  AND a.id <> b.id
  AND a.updated_at < b.updated_at;

ALTER TABLE public.athlete_goals
  ADD CONSTRAINT athlete_goals_athlete_id_sport_key UNIQUE (athlete_id, sport);

-- 4. Replace coach SELECT policy: any coach linked to the athlete can view
DROP POLICY IF EXISTS "Coaches view goals for rostered athletes" ON public.athlete_goals;

CREATE POLICY "Coaches linked to athlete view goals"
  ON public.athlete_goals FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.coach_profiles cp
      JOIN public.coach_athletes ca ON ca.coach_id = cp.id
      WHERE cp.user_id = auth.uid()
        AND ca.athlete_id = athlete_goals.athlete_id
    )
  );

-- 5. Loosen the insert/update WITH CHECK so it no longer requires coach_id
-- to match a coach_athletes row (the server will stamp coach_id from the
-- current primary; parent ownership is still enforced).
DROP POLICY IF EXISTS "Parents manage goals for own athletes - insert" ON public.athlete_goals;
DROP POLICY IF EXISTS "Parents manage goals for own athletes - update" ON public.athlete_goals;

CREATE POLICY "Parents manage goals for own athletes - insert"
  ON public.athlete_goals FOR INSERT TO authenticated
  WITH CHECK (public.is_parent_of_athlete(athlete_id));

CREATE POLICY "Parents manage goals for own athletes - update"
  ON public.athlete_goals FOR UPDATE TO authenticated
  USING (public.is_parent_of_athlete(athlete_id))
  WITH CHECK (public.is_parent_of_athlete(athlete_id));
