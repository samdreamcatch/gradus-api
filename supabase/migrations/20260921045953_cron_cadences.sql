-- lovable-cron-fallback-reviewed: two sweeps slowed down on Mariah's call (2026-09-21); both are catch-up jobs, not the thing that makes work happen.
--
-- knowledge-ingest: the admin page now drives a source to completion the
-- moment it is registered or "Run ingestion now" is pressed (it keeps calling
-- the hook until the queue is empty), so the cron only has to finish anything
-- left half-done, e.g. a coach upload registered with no admin on the page.
-- Every six hours is enough for that; per-minute was 1,440 calls a day that
-- kept the database awake for nothing.
--
-- voice-transcripts: transcripts are created at send time; the sweep only
-- retries failures and back-fills old notes. Hourly covers that with no
-- visible difference.
--
-- Same vault-stored service role key as 20260921003705; cadences only.

DO $$ BEGIN PERFORM cron.unschedule('knowledge-ingest-every-minute'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('knowledge-ingest-every-6-hours'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'knowledge-ingest-every-6-hours',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--d9b69d11-663e-4423-8783-c75a42c0e56f.lovable.app/api/public/hooks/knowledge-ingest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

DO $$ BEGIN PERFORM cron.unschedule('voice-transcripts-every-5-min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('voice-transcripts-hourly'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'voice-transcripts-hourly',
  '7 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--d9b69d11-663e-4423-8783-c75a42c0e56f.lovable.app/api/public/hooks/voice-transcripts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);
