-- Dedupe table for the practice nudge (PRD §6.6 "Practice nudge (three days
-- after a lesson)"; src/lib/practice-nudges.server.ts). Mirrors
-- `lesson_wrap_up_prompts_sent`: one row per (athlete, lesson date) already
-- nudged, written and read only by the hook route through the service role.
-- Presence means "already handled", whether or not a device token existed to
-- push to, so a retried tick never double-nudges.
CREATE TABLE IF NOT EXISTS public.practice_nudges_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes (id) ON DELETE CASCADE,
  lesson_date date NOT NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (athlete_id, lesson_date)
);

GRANT ALL ON public.practice_nudges_sent TO service_role;
ALTER TABLE public.practice_nudges_sent ENABLE ROW LEVEL SECURITY;
-- No policies for anon or authenticated: service-role bookkeeping only.
