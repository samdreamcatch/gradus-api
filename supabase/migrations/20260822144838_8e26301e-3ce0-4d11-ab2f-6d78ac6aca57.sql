CREATE OR REPLACE FUNCTION public.can_view_plan(_plan_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.plans p
    WHERE p.id = _plan_id
      AND (
        -- owning coach
        EXISTS (SELECT 1 FROM public.coach_profiles cp
                WHERE cp.id = p.coach_id AND cp.user_id = (SELECT auth.uid()))
        -- athlete viewing their own active/benched plan
        OR (p.kind = 'plan' AND p.status = ANY (ARRAY['active','benched'])
            AND EXISTS (SELECT 1 FROM public.athletes a
                        WHERE a.id = p.athlete_id AND a.user_id = (SELECT auth.uid())))
        -- parent/guardian of the athlete
        OR (p.kind = 'plan' AND p.status = ANY (ARRAY['active','benched'])
            AND p.athlete_id IS NOT NULL
            AND public.is_parent_of_athlete(p.athlete_id))
        -- coach rostered to the athlete viewing a Gradus starter plan
        OR (p.source = 'gradus' AND p.kind = 'plan'
            AND p.status = ANY (ARRAY['active','benched'])
            AND EXISTS (SELECT 1 FROM public.coach_athletes ca
                        WHERE ca.athlete_id = p.athlete_id
                          AND ca.coach_id = public.my_coach_id()))
        -- linked coach via parent-granted visibility
        OR public.can_view_shared_coach_plan(p.coach_id, p.athlete_id)
      )
  );
$function$;

DROP POLICY IF EXISTS "Athletes view plan_moves for own plans" ON public.plan_moves;
DROP POLICY IF EXISTS "Coaches manage own plan_moves - select" ON public.plan_moves;
DROP POLICY IF EXISTS "Coaches view gradus plan_moves for rostered athletes" ON public.plan_moves;
DROP POLICY IF EXISTS "Linked coaches view shared plan moves" ON public.plan_moves;
DROP POLICY IF EXISTS "Parents view plan_moves for own athletes" ON public.plan_moves;

CREATE POLICY "View plan_moves for viewable plans"
  ON public.plan_moves FOR SELECT
  TO authenticated
  USING (public.can_view_plan(plan_id));