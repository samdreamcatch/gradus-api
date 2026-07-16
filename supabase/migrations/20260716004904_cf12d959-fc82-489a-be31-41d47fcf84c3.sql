
-- 1) organizations: additive fields for search + content push versioning
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS is_listed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS content_version integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS organizations_name_search_idx
  ON public.organizations USING gin (to_tsvector('simple', name || ' ' || COALESCE(city, '') || ' ' || COALESCE(region, '')));

-- Narrow public SELECT for the search picker: id/name/city/region/logo only,
-- filtered to listed + active. Anon needs SELECT grant to hit any policy.
GRANT SELECT ON public.organizations TO anon;

DROP POLICY IF EXISTS "Public can search listed active organizations" ON public.organizations;
CREATE POLICY "Public can search listed active organizations"
  ON public.organizations FOR SELECT
  TO anon, authenticated
  USING (active = true AND is_listed = true);

-- 2) organization_leads: outreach requests from coaches
CREATE TABLE IF NOT EXISTS public.organization_leads (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  coach_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  coach_email text NOT NULL,
  requested_org_name text NOT NULL,
  requested_org_city text,
  channel text NOT NULL CHECK (channel IN ('share','copy','mailto','sms','later')),
  message_body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','contacted','converted','dismissed')),
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.organization_leads TO authenticated;
GRANT ALL ON public.organization_leads TO service_role;

ALTER TABLE public.organization_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Coaches insert their own leads" ON public.organization_leads;
CREATE POLICY "Coaches insert their own leads"
  ON public.organization_leads FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = coach_user_id);

DROP POLICY IF EXISTS "Coaches read their own leads" ON public.organization_leads;
CREATE POLICY "Coaches read their own leads"
  ON public.organization_leads FOR SELECT TO authenticated
  USING (auth.uid() = coach_user_id);

DROP POLICY IF EXISTS "Admins read all leads" ON public.organization_leads;
CREATE POLICY "Admins read all leads"
  ON public.organization_leads FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins update all leads" ON public.organization_leads;
CREATE POLICY "Admins update all leads"
  ON public.organization_leads FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS update_organization_leads_updated_at ON public.organization_leads;
CREATE TRIGGER update_organization_leads_updated_at
  BEFORE UPDATE ON public.organization_leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS organization_leads_status_idx ON public.organization_leads (status, created_at DESC);
CREATE INDEX IF NOT EXISTS organization_leads_coach_idx ON public.organization_leads (coach_user_id);

-- 3) Reserve ownership columns on moves / plans / resources for future
--    club-level content pushes. Coach-facing UI does not use these yet.
ALTER TABLE public.moves
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_org_template boolean NOT NULL DEFAULT false;

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_org_template boolean NOT NULL DEFAULT false;

ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_org_template boolean NOT NULL DEFAULT false;

-- Allow coach_id to be NULL only when the row is an org template.
ALTER TABLE public.moves ALTER COLUMN coach_id DROP NOT NULL;
ALTER TABLE public.plans ALTER COLUMN coach_id DROP NOT NULL;

-- Use a trigger (not CHECK) so future policy tweaks don't cascade into
-- constraint invalidations. Enforces: templates need org_id + no coach_id;
-- non-templates need coach_id.
CREATE OR REPLACE FUNCTION public.validate_org_template_ownership()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.is_org_template THEN
    IF NEW.organization_id IS NULL THEN
      RAISE EXCEPTION 'Org templates require organization_id';
    END IF;
    IF NEW.coach_id IS NOT NULL THEN
      RAISE EXCEPTION 'Org templates must not set coach_id';
    END IF;
  ELSE
    IF NEW.coach_id IS NULL AND TG_TABLE_NAME IN ('moves','plans') THEN
      RAISE EXCEPTION 'coach_id is required for non-template %', TG_TABLE_NAME;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_org_template_moves ON public.moves;
CREATE TRIGGER validate_org_template_moves
  BEFORE INSERT OR UPDATE ON public.moves
  FOR EACH ROW EXECUTE FUNCTION public.validate_org_template_ownership();

DROP TRIGGER IF EXISTS validate_org_template_plans ON public.plans;
CREATE TRIGGER validate_org_template_plans
  BEFORE INSERT OR UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.validate_org_template_ownership();

DROP TRIGGER IF EXISTS validate_org_template_resources ON public.resources;
CREATE TRIGGER validate_org_template_resources
  BEFORE INSERT OR UPDATE ON public.resources
  FOR EACH ROW EXECUTE FUNCTION public.validate_org_template_ownership();

-- Coach-side read access to org templates for their org (preview only, no writes).
DROP POLICY IF EXISTS "Coaches read own org move templates" ON public.moves;
CREATE POLICY "Coaches read own org move templates"
  ON public.moves FOR SELECT TO authenticated
  USING (
    is_org_template = true
    AND organization_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.coach_profiles cp
      WHERE cp.user_id = auth.uid() AND cp.organization_id = moves.organization_id
    )
  );

DROP POLICY IF EXISTS "Coaches read own org plan templates" ON public.plans;
CREATE POLICY "Coaches read own org plan templates"
  ON public.plans FOR SELECT TO authenticated
  USING (
    is_org_template = true
    AND organization_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.coach_profiles cp
      WHERE cp.user_id = auth.uid() AND cp.organization_id = plans.organization_id
    )
  );

-- 4) coach_profiles: cursor for future incremental content sync
ALTER TABLE public.coach_profiles
  ADD COLUMN IF NOT EXISTS last_synced_content_version integer NOT NULL DEFAULT 0;
