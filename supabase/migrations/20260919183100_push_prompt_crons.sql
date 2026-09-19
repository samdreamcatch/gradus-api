-- Schedules for the two push-prompt hooks (PRD §6.6; pre-QA gate P3).
-- Same shape, host, and `apikey` (the public Supabase publishable key) as
-- `20260911120100_lesson_reminders_cron.sql`; the hook routes compare the
-- header against SUPABASE_PUBLISHABLE_KEY.

-- Lesson wrap-up prompts: every 5 minutes, like lesson reminders.
SELECT cron.schedule(
  'lesson-wrap-ups-every-5-min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--d9b69d11-663e-4423-8783-c75a42c0e56f.lovable.app/api/public/hooks/lesson-wrap-ups',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkcWZhcXhtZG11anhxaHdscWRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NTQwNzMsImV4cCI6MjA5NTMzMDA3M30.wpJkFB8GO2tki58OxFPLJNlTKc4QTnDdHbbx5g2MA2k"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Competition recap prompts: once a day at 14:00 UTC (10:00 EDT / 09:00 EST),
-- the morning after a competition's `ends_on`.
SELECT cron.schedule(
  'competition-recaps-daily',
  '0 14 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--d9b69d11-663e-4423-8783-c75a42c0e56f.lovable.app/api/public/hooks/competition-recaps',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkcWZhcXhtZG11anhxaHdscWRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NTQwNzMsImV4cCI6MjA5NTMzMDA3M30.wpJkFB8GO2tki58OxFPLJNlTKc4QTnDdHbbx5g2MA2k"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
