-- Buyers rate the marketplace plans they bought (src/lib/plan-ratings.server.ts,
-- src/lib/plan-purchases.server.ts). A buyer's athlete gets their own copy of
-- the plan, so the original rule (the plan's assigned athlete and their
-- parents) never let a buyer rate the coach's listing. This adds: anyone with
-- a fulfilled purchase of the listing (the buyer, the athlete it was for, or
-- that athlete's parent) may rate it. The assigned-athlete rule is unchanged.
--
-- Replaces one function, from its definition in 20261111120300_plan_ratings;
-- no table, column or data changes, so the live app is unaffected. The
-- INSERT policy on plan_ratings calls this function, so it follows.
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
  )
  OR EXISTS (
    -- A marketplace listing the caller bought, for themselves or for their child.
    SELECT 1
    FROM public.plan_purchases pp
    JOIN public.plans l ON l.id = pp.plan_id
    WHERE pp.plan_id = _plan_id
      AND pp.status = 'fulfilled'
      AND l.coach_id IS NOT NULL
      AND (
        pp.buyer_user_id = (SELECT auth.uid())
        OR EXISTS (SELECT 1 FROM public.athletes a
                   WHERE a.id = pp.athlete_id AND a.user_id = (SELECT auth.uid()))
        OR (pp.athlete_id IS NOT NULL AND public.is_parent_of_athlete(pp.athlete_id))
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_rate_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_rate_plan(uuid) TO authenticated, service_role;
