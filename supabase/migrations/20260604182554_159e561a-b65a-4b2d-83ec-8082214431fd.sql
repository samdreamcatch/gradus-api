
CREATE TABLE public.coach_athlete_sports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  coach_id uuid NOT NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  sport text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (athlete_id, coach_id, sport)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_athlete_sports TO authenticated;
GRANT ALL ON public.coach_athlete_sports TO service_role;

ALTER TABLE public.coach_athlete_sports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Parents view own athlete coach sports"
  ON public.coach_athlete_sports FOR SELECT TO authenticated
  USING (public.is_parent_of_athlete(athlete_id));

CREATE POLICY "Parents insert own athlete coach sports"
  ON public.coach_athlete_sports FOR INSERT TO authenticated
  WITH CHECK (public.is_parent_of_athlete(athlete_id));

CREATE POLICY "Parents delete own athlete coach sports"
  ON public.coach_athlete_sports FOR DELETE TO authenticated
  USING (public.is_parent_of_athlete(athlete_id));

CREATE POLICY "Coaches view own roster coach sports"
  ON public.coach_athlete_sports FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.coach_profiles cp
    WHERE cp.id = coach_athlete_sports.coach_id AND cp.user_id = auth.uid()
  ));

CREATE OR REPLACE FUNCTION public.validate_coach_athlete_sport()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

CREATE TRIGGER validate_coach_athlete_sport_trg
  BEFORE INSERT OR UPDATE ON public.coach_athlete_sports
  FOR EACH ROW EXECUTE FUNCTION public.validate_coach_athlete_sport();

CREATE TRIGGER update_coach_athlete_sports_updated_at
  BEFORE UPDATE ON public.coach_athlete_sports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Backfill: every existing link enables all sports the coach currently offers
INSERT INTO public.coach_athlete_sports (athlete_id, coach_id, sport)
SELECT ca.athlete_id, ca.coach_id, cl.sport
FROM public.coach_athletes ca
JOIN public.coach_levels cl ON cl.coach_id = ca.coach_id
ON CONFLICT DO NOTHING;

-- When a coach link is removed, clean up the sport scoping
CREATE OR REPLACE FUNCTION public.cleanup_coach_athlete_sports()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.coach_athlete_sports
  WHERE athlete_id = OLD.athlete_id AND coach_id = OLD.coach_id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER cleanup_coach_athlete_sports_trg
  AFTER DELETE ON public.coach_athletes
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_coach_athlete_sports();
