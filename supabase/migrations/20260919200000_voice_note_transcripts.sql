-- Voice-note transcripts (PRD §6.7 item 3, amended 2026-09-19; pre-QA gate P4).
--
-- Additive: two nullable columns on messages. `transcript` is filled by
-- src/lib/voice-transcripts.server.ts right after a voice note is sent and,
-- for anything missed, by the `voice-transcripts` cron hook below.
-- `transcript_failed_at` records a failed attempt so the sweep can back off
-- and retry later instead of hammering the transcription service.
-- Readable through the existing messages RLS (a participant who can read the
-- note can read its transcript); only the service role writes them.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS transcript text,
  ADD COLUMN IF NOT EXISTS transcript_failed_at timestamptz;

-- A sender who deletes their account leaves a tombstone (migration
-- 20260830205916 blanks body / audio_url / duration); the transcript must go
-- with it. Same function, two more assignments.
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

-- The sweep asks for "voice notes with no transcript, newest first".
CREATE INDEX IF NOT EXISTS messages_voice_untranscribed_idx
  ON public.messages (created_at DESC)
  WHERE kind = 'voice' AND transcript IS NULL;

-- Same shape, host, and `apikey` (the public Supabase publishable key) as
-- `20260911120100_lesson_reminders_cron.sql`.
SELECT cron.schedule(
  'voice-transcripts-every-5-min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--d9b69d11-663e-4423-8783-c75a42c0e56f.lovable.app/api/public/hooks/voice-transcripts',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkcWZhcXhtZG11anhxaHdscWRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NTQwNzMsImV4cCI6MjA5NTMzMDA3M30.wpJkFB8GO2tki58OxFPLJNlTKc4QTnDdHbbx5g2MA2k"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);
