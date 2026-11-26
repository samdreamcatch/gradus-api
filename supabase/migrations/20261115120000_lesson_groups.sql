-- Group lessons (PRD decision #68, §6.16; milestone GL1).
--
-- A group lesson is a link between ordinary per-athlete lesson slots: member
-- slots share a `group_id`. Nothing else about a slot changes, so every
-- existing read keeps working for a client that knows nothing about groups.
--
--   athlete_lesson_slots.group_id     the link (NULL = a private lesson)
--   athlete_lesson_slots.price_cents  this lesson's own price for this
--                                     athlete; when set, invoicing uses it in
--                                     place of the athlete's rate
--   lesson_slot_overrides.billable    on a `canceled` date: the coach chose
--                                     to bill the lesson anyway
--   invoice_lines.included_reason     gains 'canceled_billed'
--   invoice_lines.is_group            the billed lesson was a group lesson
--
-- Additive only. The app code tolerates this migration not being applied yet
-- (it falls back to the old column list), so Publish and Apply may happen in
-- either order.
--
-- GRANTs: all three tables already grant SELECT/INSERT/UPDATE/DELETE to
-- `authenticated` at table level, which covers new columns. RLS policies are
-- unchanged. What is new is the write guard below: the group link and the
-- lesson price decide what a family is billed, and parents and adult athletes
-- can write their own slots under RLS, so only the server (service role) may
-- set either column, or move a slot that is in a group.
--
-- Deletes are deliberately not guarded: a family may always drop a lesson
-- (and deleting an athlete or an account cascades here). A slot left alone in
-- its group reads as a private lesson everywhere and its link is cleared the
-- next time the coach edits it.

ALTER TABLE public.athlete_lesson_slots
  ADD COLUMN IF NOT EXISTS group_id uuid,
  ADD COLUMN IF NOT EXISTS price_cents integer
    CONSTRAINT athlete_lesson_slots_price_cents_check CHECK (price_cents IS NULL OR price_cents >= 0);

-- One slot per athlete per group.
CREATE UNIQUE INDEX IF NOT EXISTS athlete_lesson_slots_group_athlete_key
  ON public.athlete_lesson_slots (group_id, athlete_id)
  WHERE group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS athlete_lesson_slots_coach_group_idx
  ON public.athlete_lesson_slots (coach_id, group_id)
  WHERE group_id IS NOT NULL;

ALTER TABLE public.lesson_slot_overrides
  ADD COLUMN IF NOT EXISTS billable boolean NOT NULL DEFAULT false;

ALTER TABLE public.invoice_lines
  ADD COLUMN IF NOT EXISTS is_group boolean NOT NULL DEFAULT false;

ALTER TABLE public.invoice_lines
  DROP CONSTRAINT IF EXISTS invoice_lines_included_reason_check;
ALTER TABLE public.invoice_lines
  ADD CONSTRAINT invoice_lines_included_reason_check
  CHECK (included_reason IN ('completed', 'manual_add', 'canceled_billed'));

-- Guard: who may set the group link and the price, and how big a group gets.
--
-- SECURITY INVOKER (the default): it reads only the table it fires on, which
-- the writer can already see, and `auth.role()`.
CREATE OR REPLACE FUNCTION public.athlete_lesson_slots_group_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_role text := auth.role();
  v_members integer;
BEGIN
  -- A signed-in user writing the table directly (not through the server) may
  -- neither set nor change the group link or the price.
  IF v_role IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.group_id IS NOT NULL OR NEW.price_cents IS NOT NULL THEN
        RAISE EXCEPTION 'group_id and price_cents are set by the server'
          USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.group_id IS DISTINCT FROM OLD.group_id
       OR NEW.price_cents IS DISTINCT FROM OLD.price_cents THEN
      RAISE EXCEPTION 'group_id and price_cents are set by the server'
        USING ERRCODE = '42501';
    ELSIF OLD.group_id IS NOT NULL
      AND (NEW.day_of_week, NEW.start_minute, NEW.end_minute, NEW.frequency,
           NEW.weeks_of_month, NEW.starts_on, NEW.athlete_id, NEW.coach_id)
          IS DISTINCT FROM
          (OLD.day_of_week, OLD.start_minute, OLD.end_minute, OLD.frequency,
           OLD.weeks_of_month, OLD.starts_on, OLD.athlete_id, OLD.coach_id) THEN
      -- A group's members share one schedule; it moves through the server,
      -- for everyone at once.
      RAISE EXCEPTION 'A group lesson is changed by its coach, for the whole group'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- A slot with no coach belongs to no group and carries no price (the coach
  -- link was removed).
  IF NEW.coach_id IS NULL THEN
    NEW.group_id := NULL;
    -- The price was that coach's; the next coach to link bills their own rate.
    NEW.price_cents := NULL;
  END IF;

  -- At most eight athletes in a group (decision #68).
  IF NEW.group_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.group_id IS DISTINCT FROM OLD.group_id) THEN
    -- One writer per group at a time, so two concurrent adds can't both
    -- count seven and land a ninth.
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.group_id::text, 0));
    SELECT count(*) INTO v_members
    FROM public.athlete_lesson_slots s
    WHERE s.group_id = NEW.group_id AND s.id <> NEW.id;
    IF v_members >= 8 THEN
      RAISE EXCEPTION 'A group lesson holds at most 8 athletes'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS athlete_lesson_slots_group_guard ON public.athlete_lesson_slots;
CREATE TRIGGER athlete_lesson_slots_group_guard
  BEFORE INSERT OR UPDATE ON public.athlete_lesson_slots
  FOR EACH ROW
  EXECUTE FUNCTION public.athlete_lesson_slots_group_guard();

-- Check after applying (expect: 2 columns, 1 column, 1 column, 1 trigger):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'athlete_lesson_slots'
--      AND column_name IN ('group_id', 'price_cents');
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'lesson_slot_overrides'
--      AND column_name = 'billable';
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'invoice_lines'
--      AND column_name = 'is_group';
--   SELECT tgname FROM pg_trigger WHERE tgname = 'athlete_lesson_slots_group_guard';
