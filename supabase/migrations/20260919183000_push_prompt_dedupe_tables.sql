-- Dedupe tables for the two cron-driven push prompts (PRD §6.6; pre-QA gate
-- P3). Both mirror `lesson_reminders_sent`: one row per thing already
-- prompted, written and read only by the hook routes through the service
-- role. Presence means "already handled", whether or not a device token
-- existed to push to, so a retried tick never double-prompts.

-- Lesson wrap-up prompt: one per (slot, lesson date), pushed to the coach
-- shortly after the lesson's end time (src/lib/lesson-wrap-up-prompts.server.ts).
CREATE TABLE IF NOT EXISTS public.lesson_wrap_up_prompts_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL,
  coach_id uuid NOT NULL,
  athlete_id uuid NOT NULL,
  lesson_date date NOT NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_id, lesson_date)
);

GRANT ALL ON public.lesson_wrap_up_prompts_sent TO service_role;
ALTER TABLE public.lesson_wrap_up_prompts_sent ENABLE ROW LEVEL SECURITY;
-- No policies for anon or authenticated: service-role bookkeeping only.

-- Competition recap prompt: one per (viewer, competition), pushed the day
-- after the competition ends (src/lib/competition-recap-prompts.server.ts).
CREATE TABLE IF NOT EXISTS public.competition_recap_prompts_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  competition_id uuid NOT NULL REFERENCES public.competitions (id) ON DELETE CASCADE,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, competition_id)
);

GRANT ALL ON public.competition_recap_prompts_sent TO service_role;
ALTER TABLE public.competition_recap_prompts_sent ENABLE ROW LEVEL SECURITY;
-- No policies for anon or authenticated: service-role bookkeeping only.
