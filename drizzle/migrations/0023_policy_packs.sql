-- Club Trust Center: policy packs group required club documents with a due date.
CREATE TABLE IF NOT EXISTS public.policy_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'club'
    CHECK (category IN ('safe_sport','communication','travel','photo_video','medical','club')),
  due_at timestamptz,
  renew_months integer CHECK (renew_months IS NULL OR renew_months BETWEEN 1 AND 60),
  archived_at timestamptz,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS policy_packs_org_idx ON public.policy_packs(organization_id);

CREATE TABLE IF NOT EXISTS public.policy_pack_items (
  pack_id uuid NOT NULL REFERENCES public.policy_packs(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE,
  PRIMARY KEY (pack_id, resource_id)
);

-- Server-only, like the rest of the club-content tables: writes go through
-- server functions that check has_org_admin first.
GRANT ALL ON public.policy_packs TO service_role;
GRANT ALL ON public.policy_pack_items TO service_role;
ALTER TABLE public.policy_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_pack_items ENABLE ROW LEVEL SECURITY;
