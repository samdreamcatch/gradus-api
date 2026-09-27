-- lovable-cron-fallback-reviewed: new job; one small batch a minute by design (Mariah, 2026-09-26).
--
-- IJS competition catalog: every U.S. Figure Skating IJS competition, found
-- automatically, so the Live board can be searched instead of each event
-- being set up in Admin -> Competitions.
--
-- IJS has no public directory (`/leaderboard/results/<year>/` answers 403).
-- Each competition lives at `/leaderboard/results/<calendar year>/<id>/index.asp`,
-- unused ids answer 404, and a page only appears once the event starts
-- publishing. So a background job walks a window of ids in the current
-- calendar year's folder, 25 page checks a minute, one at a time; a full pass
-- takes about two hours. It backs off when IJS answers slowly or with
-- 429/5xx. Mariah approved the approach and cadence on 2026-09-26.
--
-- Nothing here is personal data (competition name, dates, venue). The tables
-- are read and written only by the server's service-role client.

CREATE TABLE IF NOT EXISTS public.ijs_catalog (
  year integer NOT NULL,
  comp_id integer NOT NULL,
  name text NOT NULL DEFAULT '',
  dates_label text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  starts_on date,
  ends_on date,
  -- The earliest event start on the index page, when it parses; with
  -- first_seen_at it measures how soon a competition becomes searchable.
  first_event_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (year, comp_id)
);

CREATE INDEX IF NOT EXISTS ijs_catalog_dates_idx ON public.ijs_catalog (starts_on DESC, ends_on);

ALTER TABLE public.ijs_catalog ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.ijs_catalog TO service_role;

-- Where the sweep is in each year's id window, and its back-off.
CREATE TABLE IF NOT EXISTS public.ijs_catalog_sweep (
  year integer PRIMARY KEY,
  lo integer NOT NULL,
  hi integer NOT NULL,
  cursor integer NOT NULL,
  pass_started_at timestamptz NOT NULL DEFAULT now(),
  last_pass_completed_at timestamptz,
  paused_until timestamptz,
  backoff_minutes integer NOT NULL DEFAULT 0,
  -- A run holds this while it probes, so two minutes' runs never overlap.
  leased_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ijs_catalog_sweep ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.ijs_catalog_sweep TO service_role;

DO $$ BEGIN PERFORM cron.unschedule('ijs-catalog-sweep-every-minute'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'ijs-catalog-sweep-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--d9b69d11-663e-4423-8783-c75a42c0e56f.lovable.app/api/public/hooks/ijs-catalog-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
