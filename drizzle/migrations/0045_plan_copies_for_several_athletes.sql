-- One plan for several athletes (Mariah, 2026-11-10; PRD decision #66).
--
-- A coach gives one plan to several athletes at once. Each athlete gets their
-- own copy (an ordinary plan row with that athlete), so practice history,
-- status, and any edits the coach makes for one athlete stay per athlete. The
-- plan the coach keeps editing has no athlete; its copies point back at it.
-- When the coach changes it, they choose which copies get the update.
--
-- shared_from_id  On a copy: the plan it was copied from. Cleared (never
--                 cascaded) when that plan is deleted, so a copy an athlete
--                 has practised is never removed with it.
-- shared_synced   On a copy: the content (title, notes, feedback scope, moves)
--                 it had when it last matched the plan. A copy that no longer
--                 equals it has custom edits; a plan that no longer equals it
--                 has changes that copy has not received.
--                 On the plan itself: its content at the last update, for the
--                 "what changed" list the coach sees before sending.
-- shared_changes  On a copy: what the last update changed, for the athlete's
--                 and parent's view ({ "at": timestamp, "moves": { plan move
--                 id: "new" | "minutes" | "reps" | "changed" } }).
--
-- No new grants or policies: `plans` is granted to `authenticated` as a whole
-- table, and the existing row policies decide who reads and writes each row.
-- A coach still only writes plans they own for athletes on their roster.

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS shared_from_id uuid REFERENCES public.plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shared_synced jsonb,
  ADD COLUMN IF NOT EXISTS shared_changes jsonb;

CREATE INDEX IF NOT EXISTS idx_plans_shared_from
  ON public.plans (shared_from_id)
  WHERE shared_from_id IS NOT NULL;

-- One copy per athlete. Two requests racing to share the same plan both see
-- "nobody has a copy yet"; without this both would give every athlete a plan
-- and a notification. The second one is refused instead.
CREATE UNIQUE INDEX IF NOT EXISTS plans_one_copy_per_athlete
  ON public.plans (shared_from_id, athlete_id)
  WHERE shared_from_id IS NOT NULL AND athlete_id IS NOT NULL;

-- Who may point a plan at another. The columns are writable by anyone who can
-- write the row (the table grant is whole-table), so the link is checked here:
--   - a plan an athlete wrote for themselves (coach_id NULL) is never a copy;
--   - a copy belongs to the same coach as the plan it came from.
-- Anything else has the link dropped, so a row nobody intended can never take
-- an athlete's one-copy slot on someone else's plan. Runs as the caller: a
-- plan the caller cannot see is not one they can link to.
CREATE OR REPLACE FUNCTION public.plans_shared_link_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.coach_id IS NULL THEN
    NEW.shared_from_id := NULL;
    NEW.shared_synced := NULL;
    NEW.shared_changes := NULL;
    RETURN NEW;
  END IF;
  IF NEW.shared_from_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.shared_from_id IS DISTINCT FROM OLD.shared_from_id
          OR NEW.coach_id IS DISTINCT FROM OLD.coach_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.plans p
        WHERE p.id = NEW.shared_from_id
          AND p.coach_id = NEW.coach_id
          AND p.athlete_id IS NULL
     ) THEN
    NEW.shared_from_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_plans_shared_link_guard ON public.plans;
CREATE TRIGGER trg_plans_shared_link_guard
  BEFORE INSERT OR UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.plans_shared_link_guard();
