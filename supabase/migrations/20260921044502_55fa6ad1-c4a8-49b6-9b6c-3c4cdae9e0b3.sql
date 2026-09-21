-- lovable-cron-fallback-reviewed: pre-existing push-prompt jobs; cadence unchanged, only the credential is being re-keyed off the public anon key.
DO $$ BEGIN PERFORM cron.unschedule('lesson-reminders-every-5-min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('lesson-wrap-ups-every-5-min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('competition-recaps-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'lesson-reminders-every-5-min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--d9b69d11-663e-4423-8783-c75a42c0e56f.lovable.app/api/public/hooks/lesson-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'lesson-wrap-ups-every-5-min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--d9b69d11-663e-4423-8783-c75a42c0e56f.lovable.app/api/public/hooks/lesson-wrap-ups',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'competition-recaps-daily',
  '0 14 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--d9b69d11-663e-4423-8783-c75a42c0e56f.lovable.app/api/public/hooks/competition-recaps',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);