-- lovable-cron-fallback-reviewed: existing voice-transcript sweep; cadence unchanged, re-keyed off the public anon key.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS transcript text,
  ADD COLUMN IF NOT EXISTS transcript_failed_at timestamptz;

CREATE OR REPLACE FUNCTION public.tombstone_message_on_sender_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.body := '';
  NEW.audio_url := NULL;
  NEW.duration_seconds := NULL;
  NEW.transcript := NULL;
  NEW.transcript_failed_at := NULL;
  NEW.sender_deleted_at := COALESCE(NEW.sender_deleted_at, now());
  RETURN NEW;
END;
$$;

CREATE INDEX IF NOT EXISTS messages_voice_untranscribed_idx
  ON public.messages (created_at DESC)
  WHERE kind = 'voice' AND transcript IS NULL;

DO $$ BEGIN PERFORM cron.unschedule('voice-transcripts-every-5-min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'voice-transcripts-every-5-min',
  '*/5 * * * *',
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