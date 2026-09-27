-- Who may read another coach's plans for a shared athlete (Mariah, 2026-09-27).
-- The server mirror is src/lib/coach-plan-access.server.ts — keep in step.
--
--   * Club reads every other coach's plans on athletes it shares.
--   * Everyone else, Pro included, needs a live visibility link: both coaches
--     accepted, the parent's opt-in for both still on, both still on the
--     athlete's roster, and still covered — the athlete's Team plan is live,
--     or either coach in the pair is on Pro or Club. A lapsed Team plan locks
--     a link between two Coach-tier coaches; the link row itself stays.
--
-- Before this, "Pro and Club coaches view plans on shared athletes" let any
-- Pro coach read every other coach's plans (title, notes) with no link, and
-- links never locked when the Team plan lapsed.

-- 1) Team plan coverage: any guardian (primary or co-guardian) with a live
--    Team plan. Mirrors teamPlanActive() in src/lib/team.server.ts.
CREATE OR REPLACE FUNCTION public.athlete_team_plan_active(_athlete_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.parent_profiles pp
    WHERE pp.id IN (
        SELECT a.parent_id FROM public.athletes a
        WHERE a.id = _athlete_id AND a.parent_id IS NOT NULL
        UNION
        SELECT g.parent_id FROM public.athlete_guardians g
        WHERE g.athlete_id = _athlete_id
      )
      AND pp.subscription_status IN ('active', 'trialing', 'past_due', 'canceled')
      AND (pp.current_period_end IS NULL OR pp.current_period_end > now())
  );
$$;

-- Only the policy helpers below call it; nobody needs to probe another
-- family's billing state directly.
REVOKE ALL ON FUNCTION public.athlete_team_plan_active(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.athlete_team_plan_active(uuid) TO service_role;

-- 2) A live link between two coaches for one athlete.
CREATE OR REPLACE FUNCTION public.coaches_linked_for_athlete(
  _viewer_coach_id uuid,
  _owner_coach_id uuid,
  _athlete_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.coach_visibility_links l
    WHERE l.athlete_id = _athlete_id
      AND l.a_status = 'accepted'
      AND l.b_status = 'accepted'
      AND ((l.coach_a_id = _viewer_coach_id AND l.coach_b_id = _owner_coach_id)
        OR (l.coach_b_id = _viewer_coach_id AND l.coach_a_id = _owner_coach_id))
  )
  AND EXISTS (SELECT 1 FROM public.athlete_coach_visibility v
              WHERE v.athlete_id = _athlete_id AND v.coach_id = _viewer_coach_id)
  AND EXISTS (SELECT 1 FROM public.athlete_coach_visibility v
              WHERE v.athlete_id = _athlete_id AND v.coach_id = _owner_coach_id)
  AND EXISTS (SELECT 1 FROM public.coach_athletes ca
              WHERE ca.athlete_id = _athlete_id AND ca.coach_id = _viewer_coach_id)
  AND EXISTS (SELECT 1 FROM public.coach_athletes ca
              WHERE ca.athlete_id = _athlete_id AND ca.coach_id = _owner_coach_id)
  AND (
    public.athlete_team_plan_active(_athlete_id)
    OR public.coach_effective_tier(_viewer_coach_id) IN ('coach_pro', 'club')
    OR public.coach_effective_tier(_owner_coach_id) IN ('coach_pro', 'club')
  );
$$;

-- 3) The shared practice log / goals / schedule window follows the same rule:
--    the calling coach holds at least one live link for this athlete.
CREATE OR REPLACE FUNCTION public.shares_athlete_window(_athlete_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.coach_visibility_links l
    WHERE l.athlete_id = _athlete_id
      AND (l.coach_a_id = public.my_coach_id() OR l.coach_b_id = public.my_coach_id())
      AND public.coaches_linked_for_athlete(
        public.my_coach_id(),
        CASE WHEN l.coach_a_id = public.my_coach_id() THEN l.coach_b_id ELSE l.coach_a_id END,
        _athlete_id
      )
  );
$$;

-- 4) Blanket cross-coach plan reads are Club only. Pro reads through a live
--    link ("Linked coaches view shared plans", which uses the helper above).
DROP POLICY IF EXISTS "Pro and Club coaches view plans on shared athletes" ON public.plans;
DROP POLICY IF EXISTS "Club coaches view plans on shared athletes" ON public.plans;
CREATE POLICY "Club coaches view plans on shared athletes"
ON public.plans
FOR SELECT
TO authenticated
USING (
  kind = 'plan'
  AND status = ANY (ARRAY['active','benched'])
  AND EXISTS (
    SELECT 1
    FROM public.coach_profiles viewer
    JOIN public.coach_athletes viewer_link ON viewer_link.coach_id = viewer.id
    WHERE viewer.user_id = auth.uid()
      AND viewer_link.athlete_id = plans.athlete_id
      AND public.coach_effective_tier(viewer.id) = 'club'
  )
);
