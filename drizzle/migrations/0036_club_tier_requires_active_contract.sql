CREATE OR REPLACE FUNCTION public.coach_effective_tier(_coach_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN cp.organization_id IS NOT NULL
      AND (o.contract_ends_on IS NULL OR o.contract_ends_on >= current_date)
      AND (o.contract_starts_on IS NULL OR o.contract_starts_on <= current_date)
      THEN 'club'
    WHEN cp.subscription_tier = 'coach_pro' THEN 'coach_pro'
    ELSE 'coach'
  END
  FROM public.coach_profiles cp
  LEFT JOIN public.organizations o ON o.id = cp.organization_id
  WHERE cp.id = _coach_id
$$;
GRANT EXECUTE ON FUNCTION public.coach_effective_tier(uuid) TO authenticated, service_role;