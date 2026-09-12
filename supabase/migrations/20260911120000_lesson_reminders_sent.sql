-- Lesson-reminder dedupe table (PRD §3.8, I15).
--
-- One row per (slot_id, lesson_date) that the reminders hook has already
-- handled — whether or not a device token existed to push to. A future real
-- APNs sender reads this same table: absence means "not yet sent", presence
-- means "already handled", so the compute+dedupe logic stays correct even
-- though nothing is actually delivered yet. Service-role-only: written and
-- read exclusively by src/lib/lesson-reminders.server.ts through the admin
-- client — no end user or client ever queries this table directly.
CREATE TABLE IF NOT EXISTS public.lesson_reminders_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL,
  athlete_id uuid NOT NULL,
  -- Nullable: a slot's coach_id is nulled out when a coach is unlinked from
  -- an athlete's roster (see coach-roster.server.ts's removeAthleteFromRoster,
  -- which keeps the recurring schedule alive for a future re-link). The
  -- parent/athlete reminder must still be dedup-recorded for such a slot, so
  -- this column can't require a coach.
  coach_id uuid,
  lesson_date date NOT NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_id, lesson_date)
);

GRANT ALL ON public.lesson_reminders_sent TO service_role;

ALTER TABLE public.lesson_reminders_sent ENABLE ROW LEVEL SECURITY;
-- No policies for anon or authenticated: only the lesson-reminders hook
-- route (service role) ever reads or writes this bookkeeping table.
