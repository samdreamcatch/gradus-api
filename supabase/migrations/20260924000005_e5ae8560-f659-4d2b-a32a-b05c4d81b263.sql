CREATE TABLE IF NOT EXISTS public.athlete_skill_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  coach_id uuid REFERENCES public.coach_profiles(id) ON DELETE SET NULL,
  sport text NOT NULL DEFAULT '',
  kind text NOT NULL CHECK (kind IN ('attempted', 'landed', 'consistent', 'parked', 'dropped')),
  source text NOT NULL CHECK (source IN ('coach', 'protocol', 'inferred')),
  confidence numeric(3, 2) NOT NULL DEFAULT 1.0 CHECK (confidence > 0 AND confidence <= 1),
  move_id uuid REFERENCES public.moves(id) ON DELETE SET NULL,
  plan_move_id uuid,
  plan_id uuid REFERENCES public.plans(id) ON DELETE SET NULL,
  competition_id uuid REFERENCES public.competitions(id) ON DELETE CASCADE,
  move_name text NOT NULL DEFAULT '',
  move_category text NOT NULL DEFAULT '',
  element_code text,
  element_ref text,
  origin text CHECK (origin IN ('bench', 'remove', 'protocol', 'inference')),
  started_at timestamptz,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS athlete_skill_events_athlete_idx ON public.athlete_skill_events (athlete_id, sport, occurred_at DESC);
CREATE INDEX IF NOT EXISTS athlete_skill_events_move_idx ON public.athlete_skill_events (athlete_id, move_id) WHERE move_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS athlete_skill_events_protocol_uniq ON public.athlete_skill_events (athlete_id, competition_id, element_ref, kind) WHERE source = 'protocol';
REVOKE ALL ON public.athlete_skill_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.athlete_skill_events TO service_role;
ALTER TABLE public.athlete_skill_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.skill_inference_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  candidates integer NOT NULL DEFAULT 0,
  labeled integer NOT NULL DEFAULT 0,
  true_positive integer NOT NULL DEFAULT 0,
  false_positive integer NOT NULL DEFAULT 0,
  false_negative integer NOT NULL DEFAULT 0,
  precision numeric(4, 3),
  written_plans integer NOT NULL DEFAULT 0,
  written_events integer NOT NULL DEFAULT 0,
  failed_plans integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS skill_inference_runs_ran_at_idx ON public.skill_inference_runs (ran_at DESC);
REVOKE ALL ON public.skill_inference_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.skill_inference_runs TO service_role;
ALTER TABLE public.skill_inference_runs ENABLE ROW LEVEL SECURITY;

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