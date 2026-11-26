-- Delete replaces Bench (Mariah, 2026-11-11; PRD decision #67).
--
-- A plan a coach (or an athlete, for a plan they wrote) takes out of use is
-- "deleted": it waits in Recently deleted for 30 days, can be restored, and is
-- then removed for good. The stored status stays 'benched', so every installed
-- app and every existing policy keeps working; what is new is the clock, the
-- daily removal, and keeping the athlete's practice when the plan goes.
--
-- Templates also use status 'benched' (they have no other); they are never
-- "deleted" by this rule. Only kind = 'plan' gets a clock.

-- 1. When the plan was deleted. Plans benched before today get a fresh 30 days
--    from the moment this migration runs (Mariah, 2026-11-11).
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- The backfill must not look like an edit: `updated_at` is the time a plan was
-- benched as far as skill inference and the list order know, and stamping
-- every old benched plan "now" would have the nightly inference treat them all
-- as benched today. The row trigger that keeps `updated_at` is switched off
-- for this one statement (inside the migration's transaction).
ALTER TABLE public.plans DISABLE TRIGGER trg_plans_updated_at;
UPDATE public.plans
   SET deleted_at = now()
 WHERE kind = 'plan' AND status = 'benched' AND deleted_at IS NULL;
ALTER TABLE public.plans ENABLE TRIGGER trg_plans_updated_at;

CREATE INDEX IF NOT EXISTS idx_plans_deleted_at
  ON public.plans (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- The clock is kept by the database, not by each caller, so every path that
-- moves a plan to 'benched' (the API, the web, an older app build, a status
-- that follows a shared plan to its copies) starts it, and every path that
-- moves it away stops it. It only touches the row being written, so it runs
-- with the caller's own rights. A caller cannot push the clock back: while the
-- plan stays deleted the stored time wins; restoring and deleting again starts
-- a new 30 days, which is the coach's to do.
CREATE OR REPLACE FUNCTION public.stamp_plan_deleted_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.kind = 'plan' AND NEW.status = 'benched' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.deleted_at := now();
    ELSIF OLD.kind = 'plan' AND OLD.status = 'benched' AND OLD.deleted_at IS NOT NULL THEN
      NEW.deleted_at := OLD.deleted_at;
    ELSE
      NEW.deleted_at := now();
    END IF;
  ELSE
    NEW.deleted_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_plans_deleted_at ON public.plans;
CREATE TRIGGER trg_plans_deleted_at
  BEFORE INSERT OR UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.stamp_plan_deleted_at();

-- 2. The athlete's practice outlives the plan (Mariah, 2026-11-11: "keep the
--    practice"). Sessions were never tied to the plan by a foreign key, so
--    they already stay; what they lose with the plan is its name and whose it
--    was. Both are copied onto the session at the moment the plan is removed,
--    whoever removes it (the daily job, "Delete now", a deleted draft).
ALTER TABLE public.plan_sessions
  ADD COLUMN IF NOT EXISTS plan_title text,
  ADD COLUMN IF NOT EXISTS plan_coach_id uuid;
-- `plan_coach_id` is deliberately not a foreign key (like `plan_id` beside it).
-- Deleting a coach cascades to their plans; the trigger below then writes the
-- coach's id onto each plan's sessions while the coach row is already gone
-- from the statement's view, and a foreign key would refuse that write and
-- roll the whole account deletion back.

-- SECURITY DEFINER: the app roles have no UPDATE on plan_sessions (sessions are
-- never edited), and must not gain one for this. The function takes no input
-- from the caller: it copies two columns of the row being deleted onto that
-- plan's own sessions, always overwriting, so a value planted at insert time
-- never survives.
CREATE OR REPLACE FUNCTION public.keep_practice_of_removed_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.plan_sessions
     SET plan_title = OLD.title,
         plan_coach_id = OLD.coach_id
   WHERE plan_id = OLD.id;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.keep_practice_of_removed_plan() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_plans_keep_practice ON public.plans;
CREATE TRIGGER trg_plans_keep_practice
  BEFORE DELETE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.keep_practice_of_removed_plan();

-- 3. The daily removal. Thirty days is fixed here, in one place; the apps show
--    the same number as "days left". Moves go with the plan (their foreign
--    key cascades); practice stays (above); a shared plan's live copies keep
--    going as plans of their own (their link is cleared, never the copy).
CREATE OR REPLACE FUNCTION public.purge_deleted_plans()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _removed integer;
BEGIN
  -- A shared plan's draft copies go with it, exactly as "Delete now" removes
  -- them (the athlete was never given a draft). Copies that went live stay.
  DELETE FROM public.plans c
   USING public.plans p
   WHERE c.shared_from_id = p.id
     AND c.kind = 'plan'
     AND c.status = 'draft'
     AND p.kind = 'plan'
     AND p.status = 'benched'
     AND p.deleted_at IS NOT NULL
     AND p.deleted_at < now() - interval '30 days';

  DELETE FROM public.plans
   WHERE kind = 'plan'
     AND status = 'benched'
     AND deleted_at IS NOT NULL
     AND deleted_at < now() - interval '30 days';
  GET DIAGNOSTICS _removed = ROW_COUNT;
  RETURN _removed;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_deleted_plans() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_deleted_plans() TO service_role;

-- Once a day at 09:23 UTC (early morning in the US). Nothing can be removed
-- for the first 30 days after this migration runs.
SELECT cron.schedule(
  'purge-deleted-plans-daily',
  '23 9 * * *',
  $$ SELECT public.purge_deleted_plans(); $$
);
