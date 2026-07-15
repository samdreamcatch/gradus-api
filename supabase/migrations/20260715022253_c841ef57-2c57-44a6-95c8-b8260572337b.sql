
-- Organizations (created by Gradus admins only)
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read active orgs (needed so a coach can see the
-- org name after claiming). Admins additionally have full access.
CREATE POLICY "Authenticated can read active organizations"
  ON public.organizations FOR SELECT
  TO authenticated
  USING (active OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage organizations"
  ON public.organizations FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Org invite codes (rotatable; a single active code per org is the convention
-- but the schema allows multiple for rotation windows).
CREATE TABLE public.organization_invite_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z2-9]{8}$'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.organization_invite_codes TO authenticated;
GRANT ALL ON public.organization_invite_codes TO service_role;

ALTER TABLE public.organization_invite_codes ENABLE ROW LEVEL SECURITY;

-- Auth users can SELECT so a signed-in coach can look up "what org is this
-- code for". Lookups still go through a rate-limited server fn.
CREATE POLICY "Authenticated can read active org codes"
  ON public.organization_invite_codes FOR SELECT
  TO authenticated
  USING (active OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage org codes"
  ON public.organization_invite_codes FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX organization_invite_codes_org_idx
  ON public.organization_invite_codes(organization_id);

-- Extend coach_profiles with org + entitlement fields
ALTER TABLE public.coach_profiles
  ADD COLUMN organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN entitlement text NOT NULL DEFAULT 'pending'
    CHECK (entitlement IN ('pending', 'club_covered', 'paid', 'promo_free')),
  ADD COLUMN stripe_customer_id text,
  ADD COLUMN stripe_subscription_id text,
  ADD COLUMN subscription_status text,
  ADD COLUMN current_period_end timestamptz;

CREATE INDEX coach_profiles_organization_id_idx
  ON public.coach_profiles(organization_id);

-- Backfill: existing coaches keep working. Anyone already onboarded is
-- grandfathered as 'paid'; anyone still onboarding stays 'pending'.
UPDATE public.coach_profiles
  SET entitlement = 'paid'
  WHERE onboarded_at IS NOT NULL;
