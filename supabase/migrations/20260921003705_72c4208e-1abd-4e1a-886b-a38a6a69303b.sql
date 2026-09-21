-- lovable-cron-fallback-reviewed: pre-existing lifecycle-email job; cadence unchanged, only the credential is being re-keyed off the public anon key.
-- Re-schedule the hook cron jobs so they authenticate with the service role
-- key (pulled from the vault at call time) instead of the public anon key,
-- which ships in every browser bundle and is therefore not a credential.

SELECT cron.unschedule('billing-trial-ending-daily');
SELECT cron.unschedule('error-digest-hourly');
SELECT cron.unschedule('lifecycle-emails-every-5-min');

SELECT cron.schedule(
  'billing-trial-ending-daily',
  '0 15 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--d9b69d11-663e-4423-8783-c75a42c0e56f.lovable.app/api/public/hooks/billing-notices',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'error-digest-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--d9b69d11-663e-4423-8783-c75a42c0e56f.lovable.app/api/public/hooks/error-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'lifecycle-emails-every-5-min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--d9b69d11-663e-4423-8783-c75a42c0e56f.lovable.app/api/public/hooks/lifecycle-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
