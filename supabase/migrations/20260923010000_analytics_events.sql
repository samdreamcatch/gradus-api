-- lovable-cron-fallback-reviewed: new daily retention job for milestone A1 (PRD §6.12, §10.8); pure SQL, no hook or key.
--
-- Usage analytics (PRD decision #19, §6.12): where coaches, parents and
-- athletes spend their time in the app, Resources in particular. First-party
-- events from the iOS app through POST /api/v1/analytics/events
-- (src/lib/analytics.server.ts); the web sends none (§12 #20).
--
-- Minor athletes are de-identified at write: no user id, only an age band,
-- and the clubs/regions of their coaches' organizations, each kept only when
-- that club or region has at least 10 minor athletes at write time. Never a
-- coach, parent or athlete id (§12 #22: no per-coach breakdown for minors).
-- `has_club` separates "No club" (solo coaches only) from "Other clubs"
-- (clubs too small to name).
--
-- Service role only: RLS on with no policies; the route inserts with the
-- admin client after authenticating the caller, and the admin Usage page
-- reads through the report functions below.
CREATE TABLE IF NOT EXISTS public.analytics_events (
  -- The client's random event id: a retried batch inserts nothing twice.
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  subject text NOT NULL CHECK (subject IN ('adult', 'minor_athlete')),
  role text NOT NULL,
  age_band text,
  session_id uuid NOT NULL,
  platform text NOT NULL DEFAULT 'ios',
  app_version text NOT NULL DEFAULT '',
  os_version text NOT NULL DEFAULT '',
  event text NOT NULL,
  area text NOT NULL,
  screen text NOT NULL DEFAULT '',
  resource_id uuid,
  duration_ms integer CHECK (duration_ms IS NULL OR (duration_ms >= 0 AND duration_ms <= 1800000)),
  capped boolean NOT NULL DEFAULT false,
  org_ids uuid[] NOT NULL DEFAULT '{}',
  regions text[] NOT NULL DEFAULT '{}',
  has_club boolean NOT NULL DEFAULT false,
  props jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (subject = 'adult' OR user_id IS NULL)
);

CREATE INDEX IF NOT EXISTS analytics_events_occurred_idx ON public.analytics_events (occurred_at);
CREATE INDEX IF NOT EXISTS analytics_events_event_idx ON public.analytics_events (event, occurred_at);
CREATE INDEX IF NOT EXISTS analytics_events_resource_idx
  ON public.analytics_events (resource_id, occurred_at) WHERE resource_id IS NOT NULL;

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.analytics_events TO service_role;

-- Weekly aggregates kept after raw events age out (§12 #21: 13 months raw).
-- No user ids and no club or region: a count per week, role, subject, age
-- band, area, event and resource.
CREATE TABLE IF NOT EXISTS public.analytics_weekly (
  week_start date NOT NULL,
  role text NOT NULL,
  subject text NOT NULL,
  age_band text NOT NULL DEFAULT '',
  area text NOT NULL,
  event text NOT NULL,
  resource_id uuid,
  events bigint NOT NULL,
  total_duration_ms bigint NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS analytics_weekly_key
  ON public.analytics_weekly (week_start, role, subject, age_band, area, event, COALESCE(resource_id, '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE public.analytics_weekly ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_weekly FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.analytics_weekly TO service_role;

-- A minor athlete for analytics: no confirmed adult birthdate (a missing
-- birthdate counts as a minor, like the Ask Gradus age gate).
CREATE OR REPLACE FUNCTION public.analytics_is_minor(p_birthdate date)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT p_birthdate IS NULL OR p_birthdate > (current_date - interval '18 years');
$$;

-- Minor athletes per organization, counted through their coaches.
CREATE OR REPLACE FUNCTION public.analytics_org_minor_counts(p_org_ids uuid[])
RETURNS TABLE (org_id uuid, minors bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT cp.organization_id, count(DISTINCT a.id)
  FROM public.coach_profiles cp
  JOIN public.coach_athletes ca ON ca.coach_id = cp.id
  JOIN public.athletes a ON a.id = ca.athlete_id
  WHERE cp.organization_id = ANY (p_org_ids)
    AND public.analytics_is_minor(a.birthdate)
  GROUP BY cp.organization_id;
$$;

-- Minor athletes per region (every organization in the region).
CREATE OR REPLACE FUNCTION public.analytics_region_minor_counts(p_regions text[])
RETURNS TABLE (region text, minors bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT o.region, count(DISTINCT a.id)
  FROM public.organizations o
  JOIN public.coach_profiles cp ON cp.organization_id = o.id
  JOIN public.coach_athletes ca ON ca.coach_id = cp.id
  JOIN public.athletes a ON a.id = ca.athlete_id
  WHERE o.region = ANY (p_regions)
    AND public.analytics_is_minor(a.birthdate)
  GROUP BY o.region;
$$;

-- The roster behind the minors report: every organization with its region
-- and minor-athlete count at report time.
CREATE OR REPLACE FUNCTION public.analytics_minor_roster()
RETURNS TABLE (org_id uuid, org_name text, region text, minors bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT o.id, o.name, o.region, count(DISTINCT a.id)
  FROM public.organizations o
  JOIN public.coach_profiles cp ON cp.organization_id = o.id
  JOIN public.coach_athletes ca ON ca.coach_id = cp.id
  JOIN public.athletes a ON a.id = ca.athlete_id
  WHERE public.analytics_is_minor(a.birthdate)
  GROUP BY o.id, o.name, o.region;
$$;

-- Minor athletes none of whose coaches belong to an organization ("No club").
CREATE OR REPLACE FUNCTION public.analytics_minor_no_club_count()
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT count(DISTINCT a.id)
  FROM public.athletes a
  JOIN public.coach_athletes ca ON ca.athlete_id = a.id
  WHERE public.analytics_is_minor(a.birthdate)
    AND NOT EXISTS (
      SELECT 1 FROM public.coach_athletes ca2
      JOIN public.coach_profiles cp ON cp.id = ca2.coach_id
      WHERE ca2.athlete_id = a.id AND cp.organization_id IS NOT NULL
    );
$$;

-- Time per area per role per week.
CREATE OR REPLACE FUNCTION public.analytics_area_report(p_since timestamptz)
RETURNS TABLE (week_start date, role text, area text, total_ms bigint, screen_events bigint, adult_users bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT date_trunc('week', occurred_at)::date, role, area,
         COALESCE(sum(duration_ms), 0)::bigint, count(*), count(DISTINCT user_id)
  FROM public.analytics_events
  WHERE event = 'screen_time' AND occurred_at >= p_since
  GROUP BY 1, 2, 3;
$$;

-- Per resource: opens, users, read time, read depth, shares, offline saves.
CREATE OR REPLACE FUNCTION public.analytics_resource_report(p_since timestamptz)
RETURNS TABLE (
  resource_id uuid, opens bigint, adult_users bigint, minor_opens bigint,
  read_ms_total bigint, read_ms_median double precision, depth_median double precision,
  shares bigint, offline_saves bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT resource_id,
         count(*) FILTER (WHERE event = 'resource_open'),
         count(DISTINCT user_id) FILTER (WHERE event = 'resource_open'),
         count(*) FILTER (WHERE event = 'resource_open' AND subject = 'minor_athlete'),
         COALESCE(sum(duration_ms) FILTER (WHERE event = 'resource_read'), 0)::bigint,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE event = 'resource_read'),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY (props->>'depth')::double precision)
           FILTER (WHERE event = 'resource_read' AND props ? 'depth'),
         count(*) FILTER (WHERE event = 'resource_share'),
         count(*) FILTER (WHERE event = 'resource_offline_save')
  FROM public.analytics_events
  WHERE resource_id IS NOT NULL AND occurred_at >= p_since
  GROUP BY resource_id;
$$;

-- Ask Gradus volume per week.
CREATE OR REPLACE FUNCTION public.analytics_ask_report(p_since timestamptz)
RETURNS TABLE (week_start date, questions bigint, grounded bigint, safety bigint, saved bigint, source_taps bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT date_trunc('week', occurred_at)::date,
         count(*) FILTER (WHERE event = 'ask_question'),
         count(*) FILTER (WHERE event = 'ask_question' AND props->>'grounded' = 'true'),
         count(*) FILTER (WHERE event = 'ask_question' AND props->>'safety' = 'true'),
         count(*) FILTER (WHERE event = 'ask_answer_saved'),
         count(*) FILTER (WHERE event = 'ask_source_tap')
  FROM public.analytics_events
  WHERE event IN ('ask_question', 'ask_answer_saved', 'ask_source_tap') AND occurred_at >= p_since
  GROUP BY 1;
$$;

-- Minor athletes' activity per stored club and region (only clubs and
-- regions that passed the 10-minor test at write time are ever stored), plus
-- the "No club" and "Other" buckets. The page applies the report-time
-- thresholds and suppression (src/lib/analytics-report.ts).
CREATE OR REPLACE FUNCTION public.analytics_minor_group_report(p_since timestamptz)
RETURNS TABLE (kind text, key text, events bigint, safe_sport_opens bigint, resource_opens bigint, screen_ms bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH m AS (
    SELECT * FROM public.analytics_events
    WHERE subject = 'minor_athlete' AND occurred_at >= p_since
  )
  SELECT 'club', o::text, count(*),
         count(*) FILTER (WHERE event = 'safe_sport_open'),
         count(*) FILTER (WHERE event = 'resource_open'),
         COALESCE(sum(duration_ms) FILTER (WHERE event = 'screen_time'), 0)::bigint
  FROM m, unnest(m.org_ids) AS o GROUP BY o
  UNION ALL
  SELECT 'region', r, count(*),
         count(*) FILTER (WHERE event = 'safe_sport_open'),
         count(*) FILTER (WHERE event = 'resource_open'),
         COALESCE(sum(duration_ms) FILTER (WHERE event = 'screen_time'), 0)::bigint
  FROM m, unnest(m.regions) AS r GROUP BY r
  UNION ALL
  SELECT 'bucket', CASE WHEN NOT has_club THEN 'no_club' ELSE 'other_clubs' END, count(*),
         count(*) FILTER (WHERE event = 'safe_sport_open'),
         count(*) FILTER (WHERE event = 'resource_open'),
         COALESCE(sum(duration_ms) FILTER (WHERE event = 'screen_time'), 0)::bigint
  FROM m WHERE cardinality(org_ids) = 0 GROUP BY 2
  UNION ALL
  SELECT 'all', 'all', count(*),
         count(*) FILTER (WHERE event = 'safe_sport_open'),
         count(*) FILTER (WHERE event = 'resource_open'),
         COALESCE(sum(duration_ms) FILTER (WHERE event = 'screen_time'), 0)::bigint
  FROM m;
$$;

-- Retention (§12 #21): raw events older than 13 months become weekly
-- aggregates, then are deleted. Safe to run repeatedly.
CREATE OR REPLACE FUNCTION public.analytics_apply_retention()
RETURNS bigint
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  cutoff timestamptz := date_trunc('week', now() - interval '13 months');
  removed bigint;
BEGIN
  INSERT INTO public.analytics_weekly AS w
    (week_start, role, subject, age_band, area, event, resource_id, events, total_duration_ms)
  SELECT date_trunc('week', occurred_at)::date, role, subject, COALESCE(age_band, ''), area, event,
         resource_id, count(*), COALESCE(sum(duration_ms), 0)
  FROM public.analytics_events
  WHERE occurred_at < cutoff
  GROUP BY 1, 2, 3, 4, 5, 6, 7
  ON CONFLICT (week_start, role, subject, age_band, area, event, COALESCE(resource_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET events = w.events + EXCLUDED.events,
                total_duration_ms = w.total_duration_ms + EXCLUDED.total_duration_ms;
  DELETE FROM public.analytics_events WHERE occurred_at < cutoff;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'analytics_is_minor(date)',
    'analytics_org_minor_counts(uuid[])',
    'analytics_region_minor_counts(text[])',
    'analytics_minor_roster()',
    'analytics_minor_no_club_count()',
    'analytics_area_report(timestamptz)',
    'analytics_resource_report(timestamptz)',
    'analytics_ask_report(timestamptz)',
    'analytics_minor_group_report(timestamptz)',
    'analytics_apply_retention()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

-- Daily at 04:17 UTC.
DO $$ BEGIN PERFORM cron.unschedule('analytics-retention-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('analytics-retention-daily', '17 4 * * *', $$ SELECT public.analytics_apply_retention(); $$);
