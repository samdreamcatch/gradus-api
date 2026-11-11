-- Coach ratings (src/lib/coach-ratings.server.ts): 1–5 stars and an optional
-- review of a coach, one per person per coach, with an optional reply from
-- the coach. The coach-level twin of plan_ratings (20261111120300).
--
-- Who may rate: someone who has worked with the coach. That is an athlete on
-- their roster (coach_athletes) or that athlete's parent or guardian, or
-- anyone with a delivered marketplace purchase from them (the buyer, the
-- athlete it was for, or that athlete's parent). Never the coach themselves.
--
-- coach_profiles.rating_avg / rating_count hold each coach's totals, kept by
-- a trigger here, so the marketplace can show them without reading every
-- rating. Only the server writes them.
--
-- Additive and safe for the live app: one new table, two new columns on
-- coach_profiles (nullable, and a count defaulting to 0), new functions.
-- Rejections use SQLSTATE 42501 (insufficient_privilege), which PostgREST
-- maps to HTTP 403.

/* ------------------------------------------------------------------ table */

CREATE TABLE IF NOT EXISTS public.coach_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coach_profiles (id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review text CHECK (char_length(review) <= 2000),
  coach_response text CHECK (char_length(coach_response) <= 2000),
  coach_responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coach_ratings_one_per_user UNIQUE (coach_id, user_id)
);

-- A coach's reviews, newest first.
CREATE INDEX IF NOT EXISTS coach_ratings_coach_created_idx
  ON public.coach_ratings (coach_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS coach_ratings_user_idx ON public.coach_ratings (user_id);

COMMENT ON TABLE public.coach_ratings IS
  'One 1-5 rating (and optional review) per user per coach, from someone who worked with them; the coach may reply.';

/* ---------------------------------------------------------------- helpers */

-- Whether the caller may rate this coach: they aren't the coach, and they are
-- an athlete on the coach's roster, a parent of one, or have a delivered
-- marketplace purchase from the coach (as buyer, athlete, or that athlete's
-- parent).
CREATE OR REPLACE FUNCTION public.can_rate_coach(_coach_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.coach_profiles cp
    WHERE cp.id = _coach_id AND cp.user_id = (SELECT auth.uid())
  )
  AND (
    EXISTS (
      SELECT 1
      FROM public.coach_athletes ca
      WHERE ca.coach_id = _coach_id
        AND (
          EXISTS (SELECT 1 FROM public.athletes a
                  WHERE a.id = ca.athlete_id AND a.user_id = (SELECT auth.uid()))
          OR public.is_parent_of_athlete(ca.athlete_id)
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.plan_purchases pp
      WHERE pp.coach_id = _coach_id
        AND pp.status = 'fulfilled'
        AND (
          pp.buyer_user_id = (SELECT auth.uid())
          OR EXISTS (SELECT 1 FROM public.athletes a
                     WHERE a.id = pp.athlete_id AND a.user_id = (SELECT auth.uid()))
          OR (pp.athlete_id IS NOT NULL AND public.is_parent_of_athlete(pp.athlete_id))
        )
    )
  );
$$;

REVOKE ALL ON FUNCTION public.can_rate_coach(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_rate_coach(uuid) TO authenticated, service_role;

-- Whether the caller is this coach.
CREATE OR REPLACE FUNCTION public.is_rated_coach(_coach_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coach_profiles cp
    WHERE cp.id = _coach_id AND cp.user_id = (SELECT auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION public.is_rated_coach(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_rated_coach(uuid) TO authenticated, service_role;

/* ------------------------------------------------------- grants and RLS */

ALTER TABLE public.coach_ratings ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_ratings TO authenticated;
GRANT ALL ON public.coach_ratings TO service_role;

-- The reviewer reads their own rating; the coach reads every rating of them.
-- Everyone else reads reviews through the API (the marketplace profile).
DROP POLICY IF EXISTS "Reviewers and coaches read coach ratings" ON public.coach_ratings;
CREATE POLICY "Reviewers and coaches read coach ratings"
  ON public.coach_ratings FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_rated_coach(coach_id));

DROP POLICY IF EXISTS "People who worked with a coach rate them" ON public.coach_ratings;
CREATE POLICY "People who worked with a coach rate them"
  ON public.coach_ratings FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.can_rate_coach(coach_id)
    AND coach_response IS NULL
    AND coach_responded_at IS NULL
  );

-- Which columns each side may change is enforced by the trigger below.
DROP POLICY IF EXISTS "Reviewers update own coach ratings" ON public.coach_ratings;
CREATE POLICY "Reviewers update own coach ratings"
  ON public.coach_ratings FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()) AND public.can_rate_coach(coach_id))
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.can_rate_coach(coach_id));

DROP POLICY IF EXISTS "Coaches reply to their ratings" ON public.coach_ratings;
CREATE POLICY "Coaches reply to their ratings"
  ON public.coach_ratings FOR UPDATE
  TO authenticated
  USING (public.is_rated_coach(coach_id))
  WITH CHECK (public.is_rated_coach(coach_id));

DROP POLICY IF EXISTS "Reviewers delete own coach ratings" ON public.coach_ratings;
CREATE POLICY "Reviewers delete own coach ratings"
  ON public.coach_ratings FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

/* ------------------------------------------------- column-level guards */

-- An UPDATE policy can't say which columns change: the reviewer changes only
-- the rating and review, the coach only the reply. Not SECURITY DEFINER, so
-- is_service_caller() sees the real caller (as guard_plan_rating_columns).
CREATE OR REPLACE FUNCTION public.guard_coach_rating_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.is_service_caller() THEN
    RETURN NEW;
  END IF;

  IF NEW.coach_id IS DISTINCT FROM OLD.coach_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A rating can''t move to another coach or reviewer.'
      USING ERRCODE = '42501';
  END IF;

  IF (NEW.rating IS DISTINCT FROM OLD.rating OR NEW.review IS DISTINCT FROM OLD.review)
     AND OLD.user_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'Only the reviewer can change a rating.' USING ERRCODE = '42501';
  END IF;

  IF (NEW.coach_response IS DISTINCT FROM OLD.coach_response
      OR NEW.coach_responded_at IS DISTINCT FROM OLD.coach_responded_at)
     AND NOT public.is_rated_coach(OLD.coach_id) THEN
    RAISE EXCEPTION 'Only the coach can reply to a rating of them.' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_coach_rating_columns ON public.coach_ratings;
CREATE TRIGGER guard_coach_rating_columns
  BEFORE UPDATE ON public.coach_ratings
  FOR EACH ROW EXECUTE FUNCTION public.guard_coach_rating_columns();

/* ------------------------------------------------------- coach totals */

ALTER TABLE public.coach_profiles
  ADD COLUMN IF NOT EXISTS rating_avg numeric(3, 2),
  ADD COLUMN IF NOT EXISTS rating_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.coach_profiles.rating_avg IS
  'Average of coach_ratings.rating (NULL with no ratings). Kept by sync_coach_rating_totals; server-written only.';
COMMENT ON COLUMN public.coach_profiles.rating_count IS
  'Number of coach_ratings rows. Kept by sync_coach_rating_totals; server-written only.';

-- Recounts the coach's totals after any rating change. SECURITY DEFINER: a
-- reviewer can't update coach_profiles, and is_service_caller() then lets the
-- write past protect_coach_rating_totals.
CREATE OR REPLACE FUNCTION public.sync_coach_rating_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _coach_id uuid := COALESCE(NEW.coach_id, OLD.coach_id);
BEGIN
  UPDATE public.coach_profiles cp
  SET rating_avg = totals.avg,
      rating_count = totals.count
  FROM (
    SELECT round(avg(r.rating)::numeric, 2) AS avg, count(*)::int AS count
    FROM public.coach_ratings r
    WHERE r.coach_id = _coach_id
  ) totals
  WHERE cp.id = _coach_id;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_coach_rating_totals() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_coach_rating_totals ON public.coach_ratings;
CREATE TRIGGER sync_coach_rating_totals
  AFTER INSERT OR DELETE OR UPDATE OF rating ON public.coach_ratings
  FOR EACH ROW EXECUTE FUNCTION public.sync_coach_rating_totals();

-- A coach updates their own coach_profiles row, so without this they could
-- set their own rating. Not SECURITY DEFINER, for the same reason as above.
CREATE OR REPLACE FUNCTION public.protect_coach_rating_totals()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.is_service_caller() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.rating_avg IS NOT NULL OR NEW.rating_count <> 0 THEN
      RAISE EXCEPTION 'Coach rating totals are set by the server.' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.rating_avg IS DISTINCT FROM OLD.rating_avg
        OR NEW.rating_count IS DISTINCT FROM OLD.rating_count THEN
    RAISE EXCEPTION 'Coach rating totals are set by the server.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_coach_rating_totals ON public.coach_profiles;
CREATE TRIGGER protect_coach_rating_totals
  BEFORE INSERT OR UPDATE ON public.coach_profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_coach_rating_totals();
