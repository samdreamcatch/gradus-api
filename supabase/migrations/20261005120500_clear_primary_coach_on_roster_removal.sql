-- A coach who leaves an athlete's roster stops being that athlete's primary coach.
--
-- A coach can delete their own roster link ("Coaches can delete own roster links")
-- and nothing then cleared the athlete_primary_coaches row that pointed at them:
-- the only AFTER DELETE trigger on coach_athletes, cleanup_coach_athlete_sports,
-- clears coach_athlete_sports and nothing else. The parent unlink
-- (unlinkParentAthleteFromCoach) and the safety sever (severCoachAthlete) delete
-- the primary row in code before deleting the link, so those paths were fine, but
-- the coach's own removal left a primary coach who is no longer on the roster. The
-- parent and athlete goals screens go on showing that coach's weekly-hours target
-- and level hours to the family as "your primary coach's" expectation.
--
-- validate_athlete_primary_coach already refuses a primary row for a coach who is
-- not linked to the athlete, on INSERT and UPDATE; this keeps the same rule true
-- when the link goes away afterwards, whichever path removes it.
--
-- 1. A new AFTER DELETE trigger on coach_athletes removes the departing coach's
--    primary-coach rows for that athlete (any sport). Only that coach's rows go;
--    another coach's primary row, and the athlete's other links, are untouched.
--    A new function and trigger: the existing cleanup_coach_athlete_sports is not
--    replaced. SECURITY DEFINER like it, because the coach deleting their link
--    has no DELETE policy on athlete_primary_coaches (only parents and
--    self-managed athletes do). The parent and safety paths delete the primary
--    row first, so for them this deletes nothing.
--
-- 2. A one-time clean-up of rows already left behind by the same gap: primary-coach
--    rows whose coach has no coach_athletes row for the athlete. By the invariant
--    above such a row is invalid, and the next time the family opens
--    "Primary coach" (ensurePrimaryCoach) another linked coach who teaches the
--    sport is picked, or the screens fall back to the Gradus default hours. This
--    deletes data, so run the read-only count below first if you want to see it:
--
--      SELECT apc.athlete_id, apc.sport, apc.coach_id
--      FROM public.athlete_primary_coaches apc
--      WHERE NOT EXISTS (SELECT 1 FROM public.coach_athletes ca
--                        WHERE ca.coach_id = apc.coach_id AND ca.athlete_id = apc.athlete_id);
--
-- Left alone on purpose: coach_athlete_practice_targets and coach_levels rows of the
-- departed coach (they are the coach's own data and stop showing once the primary
-- row is gone), athlete_goals, and every RLS policy.
--
-- Idempotent: safe to re-apply.

CREATE OR REPLACE FUNCTION public.clear_primary_coach_on_roster_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.athlete_primary_coaches
  WHERE athlete_id = OLD.athlete_id AND coach_id = OLD.coach_id;
  RETURN OLD;
END;
$function$;

-- A trigger function: nobody calls it directly and the trigger needs no role to hold EXECUTE.
REVOKE ALL ON FUNCTION public.clear_primary_coach_on_roster_removal() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clear_primary_coach_on_roster_removal_trg ON public.coach_athletes;
CREATE TRIGGER clear_primary_coach_on_roster_removal_trg
  AFTER DELETE ON public.coach_athletes
  FOR EACH ROW EXECUTE FUNCTION public.clear_primary_coach_on_roster_removal();

DELETE FROM public.athlete_primary_coaches apc
WHERE NOT EXISTS (
  SELECT 1 FROM public.coach_athletes ca
  WHERE ca.coach_id = apc.coach_id AND ca.athlete_id = apc.athlete_id
);
