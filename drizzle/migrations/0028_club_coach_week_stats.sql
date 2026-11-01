-- Private aggregate snapshots. No athlete identifiers or text can enter this table.
CREATE TABLE public.org_coach_week_stats (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  coach_id uuid NOT NULL REFERENCES public.coach_profiles(id),
  week_start date NOT NULL,
  students integer,
  minors integer,
  practice_min numeric NOT NULL DEFAULT 0,
  target_min numeric,
  sessions integer NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, coach_id, week_start)
);
GRANT SELECT ON public.org_coach_week_stats TO authenticated;
GRANT ALL ON public.org_coach_week_stats TO service_role;
ALTER TABLE public.org_coach_week_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Club admins read coach aggregates" ON public.org_coach_week_stats
  FOR SELECT TO authenticated USING (public.has_org_admin(auth.uid(), organization_id));

-- Called only after the server verifies the caller's club membership.
-- Reconstruct practice from recorded sessions, not mood ratings or goal changes.
-- Historic roster/targets cannot be reconstructed: preserve NULL, not today's counts.
CREATE FUNCTION public.refresh_club_coach_weeks(p_org uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_week date := date_trunc('week', now() AT TIME ZONE 'UTC')::date;
BEGIN
  PERFORM id FROM public.organizations WHERE id = p_org FOR UPDATE;
  WITH coaches AS (
    SELECT id FROM public.coach_profiles WHERE organization_id = p_org
  ), roster AS (
    SELECT c.id AS coach_id, count(a.id)::integer AS students,
      count(a.id) FILTER (WHERE a.birthdate IS NULL OR a.birthdate > current_date - interval '18 years')::integer AS minors
    FROM coaches c LEFT JOIN public.coach_athletes ca ON ca.coach_id = c.id
    LEFT JOIN public.athletes a ON a.id = ca.athlete_id GROUP BY c.id
  ), expected AS (
    SELECT c.id AS coach_id,
      CASE WHEN count(ca.athlete_id) = 0 THEN 0
        WHEN count(ca.athlete_id) FILTER (WHERE t.minutes IS NULL) > 0 THEN NULL
        ELSE sum(t.minutes) END AS minutes
    FROM coaches c LEFT JOIN public.coach_athletes ca ON ca.coach_id = c.id
    LEFT JOIN LATERAL (
      SELECT CASE WHEN count(*) FILTER (WHERE coalesce(pt.hours_per_week, cl.practice_hours_per_week) IS NULL) > 0 THEN NULL
        ELSE sum(coalesce(pt.hours_per_week, cl.practice_hours_per_week) * 60) END AS minutes
      FROM (
        SELECT DISTINCT ON (sport) sport, athlete_id, current_level_key
        FROM public.athlete_goals
        WHERE athlete_id = ca.athlete_id
        ORDER BY sport, (coach_id = c.id) DESC NULLS LAST, updated_at DESC, id
      ) g
      JOIN public.athlete_primary_coaches pc ON pc.athlete_id = g.athlete_id AND pc.sport = g.sport AND pc.coach_id = c.id
      LEFT JOIN public.coach_levels cl ON cl.coach_id = c.id AND cl.sport = g.sport AND cl.level_key = g.current_level_key
      LEFT JOIN public.coach_athlete_practice_targets pt ON pt.coach_id = c.id AND pt.athlete_id = g.athlete_id AND pt.sport = g.sport
      WHERE g.athlete_id = ca.athlete_id
    ) t ON true GROUP BY c.id
  ), practice AS (
    SELECT p.coach_id, date_trunc('week', s.logged_at AT TIME ZONE 'UTC')::date AS week_start,
      sum(s.duration_seconds)::numeric / 60 AS minutes, count(*)::integer AS sessions
    FROM public.plan_sessions s JOIN public.plans p ON p.id = s.plan_id AND p.athlete_id = s.athlete_id AND p.kind = 'plan'
    JOIN coaches c ON c.id = p.coach_id
    WHERE s.logged_at >= (current_week - 49)::timestamp AT TIME ZONE 'UTC'
      AND s.logged_at < (current_week + 7)::timestamp AT TIME ZONE 'UTC'
    GROUP BY p.coach_id, date_trunc('week', s.logged_at AT TIME ZONE 'UTC')::date
  )
  INSERT INTO public.org_coach_week_stats (organization_id, coach_id, week_start, students, minors, practice_min, target_min, sessions, computed_at)
  SELECT p_org, c.id, w::date,
    CASE WHEN w::date = current_week THEN r.students ELSE old.students END,
    CASE WHEN w::date = current_week THEN r.minors ELSE old.minors END,
    coalesce(p.minutes, 0), CASE WHEN w::date = current_week THEN e.minutes ELSE old.target_min END,
    coalesce(p.sessions, 0), now()
  FROM coaches c CROSS JOIN generate_series(current_week - 49, current_week, interval '7 days') w
  JOIN roster r ON r.coach_id = c.id JOIN expected e ON e.coach_id = c.id
  LEFT JOIN practice p ON p.coach_id = c.id AND p.week_start = w::date
  LEFT JOIN public.org_coach_week_stats old ON old.organization_id = p_org AND old.coach_id = c.id AND old.week_start = w::date
  ON CONFLICT (organization_id, coach_id, week_start) DO UPDATE SET
    students = excluded.students, minors = excluded.minors, practice_min = excluded.practice_min,
    target_min = excluded.target_min, sessions = excluded.sessions, computed_at = excluded.computed_at;
END $$;
REVOKE ALL ON FUNCTION public.refresh_club_coach_weeks(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_club_coach_weeks(uuid) TO service_role;