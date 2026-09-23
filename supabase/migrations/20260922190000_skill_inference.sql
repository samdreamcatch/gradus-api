-- lovable-cron-fallback-reviewed: new nightly job for milestone L3 (PRD §6.7 item 5), same vault-stored service role key and URL as 20260921045953.
--
-- The skill-inference job reads benched plans that the coach did not answer
-- the "why?" prompt for, and writes `landed` events with source = inferred
-- when the plan's last sessions were a sustained run of Locked in / Flowing
-- (src/lib/skill-inference.server.ts). Every run also replays the rule
-- against the coach-answered plans and records its precision here, so the
-- rule can be tuned or switched off (SKILL_INFERENCE_ENABLED=false keeps
-- measuring and stops writing).
--
-- Service role only: RLS on with no policies; the hook writes with the admin
-- client after checking the caller's service role key.
CREATE TABLE IF NOT EXISTS public.skill_inference_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  candidates integer NOT NULL DEFAULT 0,
  labeled integer NOT NULL DEFAULT 0,
  true_positive integer NOT NULL DEFAULT 0,
  false_positive integer NOT NULL DEFAULT 0,
  false_negative integer NOT NULL DEFAULT 0,
  -- Of the coach-answered plans the rule would call landed, the share the
  -- coach said "landed it" about. Null when the rule predicted none.
  precision numeric(4, 3),
  written_plans integer NOT NULL DEFAULT 0,
  written_events integer NOT NULL DEFAULT 0,
  failed_plans integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS skill_inference_runs_ran_at_idx
  ON public.skill_inference_runs (ran_at DESC);

ALTER TABLE public.skill_inference_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.skill_inference_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.skill_inference_runs TO service_role;

-- Nightly at 07:23 UTC (the small hours in the US).
DO $$ BEGIN PERFORM cron.unschedule('skill-inference-nightly'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'skill-inference-nightly',
  '23 7 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--d9b69d11-663e-4423-8783-c75a42c0e56f.lovable.app/api/public/hooks/skill-inference',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);
