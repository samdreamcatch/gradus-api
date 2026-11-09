-- Plan ratings (src/lib/plan-ratings.server.ts): 1–5 stars and an optional
-- review on a coach's plan, one per person per plan, with an optional reply
-- from the plan's coach.
--
-- Who may rate: the athlete a plan is assigned to, and that athlete's parents
-- or guardians, once the plan has been shared with them (active or benched).
-- Nobody else, the plan's coach included. Purchases aren't recorded yet;
-- buyers join this rule when they are.
--
-- plans.rating_avg / plans.rating_count hold each plan's totals, kept by a
-- trigger here, so the marketplace can show and sort by rating without
-- reading every rating. Only the server writes them.
--
-- Rejections use SQLSTATE 42501 (insufficient_privilege), which PostgREST
-- maps to HTTP 403.

/* ------------------------------------------------------------------ table */

CREATE TABLE IF NOT EXISTS public.plan_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.plans (id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review text CHECK (char_length(review) <= 2000),
  coach_response text CHECK (char_length(coach_response) <= 2000),
  coach_responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_ratings_one_per_user UNIQUE (plan_id, user_id)
);

-- A plan's reviews, newest first.
CREATE INDEX IF NOT EXISTS plan_ratings_plan_created_idx
  ON public.plan_ratings (plan_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS plan_ratings_user_idx ON public.plan_ratings (user_id);

COMMENT ON TABLE public.plan_ratings IS
  'One 1-5 rating (and optional review) per user per plan, from the plan''s athlete or their parents; the plan coach may reply.';

/* ---------------------------------------------------------------- helpers */

-- Whether the caller may rate this plan: it is a coach's plan shared with an
-- athlete (kind plan, active or benched), and the caller is that athlete or
-- one of their parents or guardians.
CREATE OR REPLACE FUNCTION public.can_rate_plan(_plan_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.plans p
    WHERE p.id = _plan_id
      AND p.kind = 'plan'
      AND p.coach_id IS NOT NULL
      AND p.athlete_id IS NOT NULL
      AND p.status = ANY (ARRAY['active', 'benched'])
      AND (
        EXISTS (SELECT 1 FROM public.athletes a
                WHERE a.id = p.athlete_id AND a.user_id = (SELECT auth.uid()))
        OR public.is_parent_of_athlete(p.athlete_id)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_rate_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_rate_plan(uuid) TO authenticated, service_role;

-- Whether the caller is the coach who owns this plan.
CREATE OR REPLACE FUNCTION public.is_plan_coach(_plan_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.plans p
    JOIN public.coach_profiles cp ON cp.id = p.coach_id
    WHERE p.id = _plan_id
      AND cp.user_id = (SELECT auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION public.is_plan_coach(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_plan_coach(uuid) TO authenticated, service_role;

/* ------------------------------------------------------- grants and RLS */

ALTER TABLE public.plan_ratings ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_ratings TO authenticated;
GRANT ALL ON public.plan_ratings TO service_role;

-- The reviewer reads their own rating; the plan's coach reads every rating on
-- it. Everyone else reads reviews through the API (marketplace listings).
DROP POLICY IF EXISTS "Reviewers and plan coaches read plan ratings" ON public.plan_ratings;
CREATE POLICY "Reviewers and plan coaches read plan ratings"
  ON public.plan_ratings FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_plan_coach(plan_id));

DROP POLICY IF EXISTS "Plan athletes and parents rate plans" ON public.plan_ratings;
CREATE POLICY "Plan athletes and parents rate plans"
  ON public.plan_ratings FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.can_rate_plan(plan_id)
    AND coach_response IS NULL
    AND coach_responded_at IS NULL
  );

-- Which columns each side may change is enforced by the trigger below.
DROP POLICY IF EXISTS "Reviewers update own plan ratings" ON public.plan_ratings;
CREATE POLICY "Reviewers update own plan ratings"
  ON public.plan_ratings FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()) AND public.can_rate_plan(plan_id))
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.can_rate_plan(plan_id));

DROP POLICY IF EXISTS "Plan coaches reply to plan ratings" ON public.plan_ratings;
CREATE POLICY "Plan coaches reply to plan ratings"
  ON public.plan_ratings FOR UPDATE
  TO authenticated
  USING (public.is_plan_coach(plan_id))
  WITH CHECK (public.is_plan_coach(plan_id));

DROP POLICY IF EXISTS "Reviewers delete own plan ratings" ON public.plan_ratings;
CREATE POLICY "Reviewers delete own plan ratings"
  ON public.plan_ratings FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

/* ------------------------------------------------- column-level guards */

-- An UPDATE policy can't say which columns change: the reviewer changes only
-- the rating and review, the plan's coach only the reply. Not SECURITY
-- DEFINER, so is_service_caller() sees the real caller (see
-- 20260905200000_protect_billing_columns.sql).
CREATE OR REPLACE FUNCTION public.guard_plan_rating_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.is_service_caller() THEN
    RETURN NEW;
  END IF;

  IF NEW.plan_id IS DISTINCT FROM OLD.plan_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A rating can''t move to another plan or reviewer.'
      USING ERRCODE = '42501';
  END IF;

  IF (NEW.rating IS DISTINCT FROM OLD.rating OR NEW.review IS DISTINCT FROM OLD.review)
     AND OLD.user_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'Only the reviewer can change a rating.' USING ERRCODE = '42501';
  END IF;

  IF (NEW.coach_response IS DISTINCT FROM OLD.coach_response
      OR NEW.coach_responded_at IS DISTINCT FROM OLD.coach_responded_at)
     AND NOT public.is_plan_coach(OLD.plan_id) THEN
    RAISE EXCEPTION 'Only the plan''s coach can reply to a rating.' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_plan_rating_columns ON public.plan_ratings;
CREATE TRIGGER guard_plan_rating_columns
  BEFORE UPDATE ON public.plan_ratings
  FOR EACH ROW EXECUTE FUNCTION public.guard_plan_rating_columns();

/* ------------------------------------------------------- plan totals */

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS rating_avg numeric(3, 2),
  ADD COLUMN IF NOT EXISTS rating_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.plans.rating_avg IS
  'Average of plan_ratings.rating (NULL with no ratings). Kept by sync_plan_rating_totals; server-written only.';
COMMENT ON COLUMN public.plans.rating_count IS
  'Number of plan_ratings rows. Kept by sync_plan_rating_totals; server-written only.';

-- The marketplace sorts active plans by rating.
CREATE INDEX IF NOT EXISTS plans_active_rating_idx
  ON public.plans (rating_avg DESC NULLS LAST, rating_count DESC)
  WHERE status = 'active';

-- Recounts the plan's totals after any rating change. SECURITY DEFINER: a
-- reviewer can't update plans, and is_service_caller() then lets the write
-- past protect_plan_rating_totals.
CREATE OR REPLACE FUNCTION public.sync_plan_rating_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _plan_id uuid := COALESCE(NEW.plan_id, OLD.plan_id);
BEGIN
  UPDATE public.plans p
  SET rating_avg = totals.avg,
      rating_count = totals.count
  FROM (
    SELECT round(avg(r.rating)::numeric, 2) AS avg, count(*)::int AS count
    FROM public.plan_ratings r
    WHERE r.plan_id = _plan_id
  ) totals
  WHERE p.id = _plan_id;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_plan_rating_totals() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_plan_rating_totals ON public.plan_ratings;
CREATE TRIGGER sync_plan_rating_totals
  AFTER INSERT OR DELETE OR UPDATE OF rating ON public.plan_ratings
  FOR EACH ROW EXECUTE FUNCTION public.sync_plan_rating_totals();

-- A coach updates their own plans row, so without this they could set their
-- own rating. Not SECURITY DEFINER, for the same reason as above.
CREATE OR REPLACE FUNCTION public.protect_plan_rating_totals()
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
      RAISE EXCEPTION 'Plan rating totals are set by the server.' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.rating_avg IS DISTINCT FROM OLD.rating_avg
        OR NEW.rating_count IS DISTINCT FROM OLD.rating_count THEN
    RAISE EXCEPTION 'Plan rating totals are set by the server.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_plan_rating_totals ON public.plans;
CREATE TRIGGER protect_plan_rating_totals
  BEFORE INSERT OR UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.protect_plan_rating_totals();
