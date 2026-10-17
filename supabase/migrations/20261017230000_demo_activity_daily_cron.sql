-- lovable-cron-fallback-reviewed: new daily job; re-dates the App Review demo athlete's test rows so the demo coach's pre-lesson briefing never goes blank. Same vault-stored service role key and hook shape as the other sweeps.
--
-- The pre-lesson briefing (src/lib/pre-lesson-briefing.server.ts) reads the
-- 14 days before a lesson, so the demo athlete's seeded practice sessions
-- and messages age out two weeks after they're written. Once a day this
-- moves the same rows back to recent dates (src/lib/demo-activity.server.ts):
-- is_test rows of the default demo accounts only, never any others, and
-- nothing at all if the demo accounts don't exist. 08:17 UTC is the middle of
-- the night in the US, when nobody is likely to be reading the thread.

DO $$ BEGIN PERFORM cron.unschedule('demo-activity-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'demo-activity-daily',
  '17 8 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--d9b69d11-663e-4423-8783-c75a42c0e56f.lovable.app/api/public/hooks/demo-activity',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);
