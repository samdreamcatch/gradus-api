DROP INDEX IF EXISTS public.one_active_plan_per_coach_athlete;
CREATE UNIQUE INDEX two_active_plans_per_coach_athlete
  ON public.plans (coach_id, athlete_id, id)
  WHERE (kind = 'plan' AND status = 'active');
-- Note: above index just ensures uniqueness by id which is trivially true;
-- we keep no cap at the DB level. Application enforces the max of 2.