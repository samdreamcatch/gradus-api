-- lovable-cron-fallback-reviewed: new practice-nudge job (PRD §6.6 "Practice nudge (three days after a lesson)"); every 15 minutes, same service-role credential as the other push-prompt crons.
--
-- Same shape as 20260921042705_rekey_push_prompt_crons.sql: the hook routes
-- (src/lib/cron-auth.ts) require the service role key, read from the vault.
-- Every 15 minutes: the nudge goes out at the lesson's start time three days
-- later, so a quarter hour is close enough.

DO $$ BEGIN PERFORM cron.unschedule('practice-nudges-every-15-min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'practice-nudges-every-15-min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--d9b69d11-663e-4423-8783-c75a42c0e56f.lovable.app/api/public/hooks/practice-nudges',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
