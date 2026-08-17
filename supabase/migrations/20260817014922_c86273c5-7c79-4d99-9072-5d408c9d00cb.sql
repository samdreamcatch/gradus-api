WITH eligible_welcome AS (
  SELECT cp.user_id FROM public.coach_profiles cp WHERE COALESCE(cp.is_test, false) = false
  UNION
  SELECT pp.user_id FROM public.parent_profiles pp WHERE COALESCE(pp.is_test, false) = false
  UNION
  SELECT a.user_id FROM public.athletes a WHERE a.user_id IS NOT NULL AND COALESCE(a.is_test, false) = false
)
INSERT INTO public.lifecycle_email_jobs (user_id, kind)
SELECT ew.user_id, 'welcome'
FROM eligible_welcome ew
WHERE NOT EXISTS (
  SELECT 1 FROM public.lifecycle_email_jobs j
  WHERE j.user_id = ew.user_id AND j.kind = 'welcome'
)
AND NOT EXISTS (
  SELECT 1 FROM public.email_send_log l
  WHERE l.recipient_email = (SELECT u.email FROM auth.users u WHERE u.id = ew.user_id)
    AND l.template_name = 'welcome'
    AND l.status IN ('pending', 'sent')
)
ON CONFLICT (user_id, kind) DO NOTHING;

WITH eligible_activation AS (
  SELECT cp.user_id
  FROM public.coach_athletes ca
  JOIN public.coach_profiles cp ON cp.id = ca.coach_id
  WHERE COALESCE(cp.is_test, false) = false
  UNION
  SELECT a.user_id
  FROM public.coach_athletes ca
  JOIN public.athletes a ON a.id = ca.athlete_id
  WHERE a.user_id IS NOT NULL AND COALESCE(a.is_test, false) = false
  UNION
  SELECT pp.user_id
  FROM public.athletes a
  JOIN public.parent_profiles pp ON pp.id = a.parent_id
  WHERE COALESCE(a.is_test, false) = false AND COALESCE(pp.is_test, false) = false
)
INSERT INTO public.lifecycle_email_jobs (user_id, kind)
SELECT ea.user_id, 'activation'
FROM eligible_activation ea
WHERE NOT EXISTS (
  SELECT 1 FROM public.lifecycle_email_jobs j
  WHERE j.user_id = ea.user_id AND j.kind = 'activation'
)
AND NOT EXISTS (
  SELECT 1 FROM public.email_send_log l
  WHERE l.recipient_email = (SELECT u.email FROM auth.users u WHERE u.id = ea.user_id)
    AND l.template_name = 'activation'
    AND l.status IN ('pending', 'sent')
)
ON CONFLICT (user_id, kind) DO NOTHING;