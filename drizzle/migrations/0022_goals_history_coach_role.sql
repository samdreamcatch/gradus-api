-- Starting levels at invite (Mariah, 2026-10-27, decision #60).
--
-- A coach may pre-populate an athlete's current level and season target when
-- inviting them (New athlete sheet, schedule import review). The write lands
-- in athlete_goals like any other save and is recorded in
-- athlete_goals_history with a third author role, 'coach', so the coach's
-- athlete detail can say "Set by you" and the parent's (or adult athlete's)
-- sign-up goals step can say "Suggested by Coach <name>" until they save
-- their own version (src/lib/goals-history.server.ts).
--
-- The parent-versus-athlete "different goals" rule is unchanged: a coach row
-- is never the version the family disagrees with.
ALTER TABLE public.athlete_goals_history
  DROP CONSTRAINT IF EXISTS athlete_goals_history_changed_by_role_check;
ALTER TABLE public.athlete_goals_history
  ADD CONSTRAINT athlete_goals_history_changed_by_role_check
  CHECK (changed_by_role IN ('parent', 'athlete', 'coach'));
