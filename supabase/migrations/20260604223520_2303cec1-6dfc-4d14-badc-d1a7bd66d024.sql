UPDATE plan_sessions ps
SET athlete_id = p.athlete_id
FROM plans p
WHERE ps.plan_id = p.id
  AND ps.athlete_id IS DISTINCT FROM p.athlete_id;