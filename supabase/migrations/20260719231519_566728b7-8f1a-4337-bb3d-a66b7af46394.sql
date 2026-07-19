-- 1. org_admins
CREATE TABLE public.org_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX idx_org_admins_user ON public.org_admins(user_id);
CREATE INDEX idx_org_admins_org ON public.org_admins(organization_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_admins TO authenticated;
GRANT ALL ON public.org_admins TO service_role;
ALTER TABLE public.org_admins ENABLE ROW LEVEL SECURITY;

-- Helper functions (defined before policies that use them).
CREATE OR REPLACE FUNCTION public.has_org_admin(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_admins
    WHERE user_id = _user_id AND organization_id = _org_id
  )
$$;

CREATE OR REPLACE FUNCTION public.is_any_org_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.org_admins WHERE user_id = _user_id)
$$;

-- Policies on org_admins
CREATE POLICY "Admins read their orgs' admin list"
  ON public.org_admins FOR SELECT TO authenticated
  USING (public.has_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins manage their orgs' admin list"
  ON public.org_admins FOR ALL TO authenticated
  USING (public.has_org_admin(auth.uid(), organization_id))
  WITH CHECK (public.has_org_admin(auth.uid(), organization_id));

CREATE POLICY "Internal admins manage all org admins"
  ON public.org_admins FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));


-- 2. org_coach_invites
CREATE TABLE public.org_coach_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text,
  phone text,
  invite_token text NOT NULL UNIQUE,
  invite_code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE INDEX idx_org_coach_invites_org ON public.org_coach_invites(organization_id);
CREATE INDEX idx_org_coach_invites_status ON public.org_coach_invites(organization_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_coach_invites TO authenticated;
GRANT ALL ON public.org_coach_invites TO service_role;
ALTER TABLE public.org_coach_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins read their invites"
  ON public.org_coach_invites FOR SELECT TO authenticated
  USING (public.has_org_admin(auth.uid(), organization_id));

CREATE POLICY "Org admins manage their invites"
  ON public.org_coach_invites FOR ALL TO authenticated
  USING (public.has_org_admin(auth.uid(), organization_id))
  WITH CHECK (public.has_org_admin(auth.uid(), organization_id));

CREATE POLICY "Internal admins read all invites"
  ON public.org_coach_invites FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_org_coach_invites_updated_at
  BEFORE UPDATE ON public.org_coach_invites
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- 3. org_admin_actions (audit trail)
CREATE TABLE public.org_admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  target_coach_id uuid REFERENCES public.coach_profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_org_admin_actions_org ON public.org_admin_actions(organization_id, created_at DESC);
CREATE INDEX idx_org_admin_actions_coach ON public.org_admin_actions(target_coach_id, created_at DESC);

GRANT SELECT, INSERT ON public.org_admin_actions TO authenticated;
GRANT ALL ON public.org_admin_actions TO service_role;
ALTER TABLE public.org_admin_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins read their audit"
  ON public.org_admin_actions FOR SELECT TO authenticated
  USING (public.has_org_admin(auth.uid(), organization_id));

CREATE POLICY "Org admins write audit rows for themselves"
  ON public.org_admin_actions FOR INSERT TO authenticated
  WITH CHECK (
    actor_user_id = auth.uid()
    AND public.has_org_admin(auth.uid(), organization_id)
  );

CREATE POLICY "Coaches read audit rows targeting them"
  ON public.org_admin_actions FOR SELECT TO authenticated
  USING (
    target_coach_id IN (
      SELECT id FROM public.coach_profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Internal admins read all audit"
  ON public.org_admin_actions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));


-- 4. Extend resources to support org-owned templates (seed on join).
ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS is_org_template boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_resources_org_template
  ON public.resources(organization_id)
  WHERE is_org_template = true;

-- Org admins manage org-template resources for their org.
CREATE POLICY "Org admins manage org resource templates"
  ON public.resources FOR ALL TO authenticated
  USING (
    is_org_template = true
    AND organization_id IS NOT NULL
    AND public.has_org_admin(auth.uid(), organization_id)
  )
  WITH CHECK (
    is_org_template = true
    AND organization_id IS NOT NULL
    AND public.has_org_admin(auth.uid(), organization_id)
  );
