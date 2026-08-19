select cron.schedule(
  'billing-trial-ending-daily',
  '0 15 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--d9b69d11-663e-4423-8783-c75a42c0e56f.lovable.app/api/public/hooks/billing-notices',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkcWZhcXhtZG11anhxaHdscWRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NTQwNzMsImV4cCI6MjA5NTMzMDA3M30.wpJkFB8GO2tki58OxFPLJNlTKc4QTnDdHbbx5g2MA2k"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);