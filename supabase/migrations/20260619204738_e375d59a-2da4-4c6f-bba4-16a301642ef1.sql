CREATE OR REPLACE FUNCTION public.parent_has_athlete_in_sport(_sport text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM athletes a
    JOIN parent_profiles pp ON pp.id = a.parent_id
    WHERE pp.user_id = auth.uid()
      AND (
        EXISTS (SELECT 1 FROM athlete_goals g
                WHERE g.athlete_id = a.id AND g.sport = _sport)
        OR EXISTS (SELECT 1 FROM coach_athlete_sports cas
                   WHERE cas.athlete_id = a.id AND cas.sport = _sport)
      )
  );
$function$;