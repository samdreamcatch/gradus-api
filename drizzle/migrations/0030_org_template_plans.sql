CREATE TABLE public.org_template_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sport text NOT NULL,
  level_keys text[] NOT NULL DEFAULT '{}',
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  notes text NOT NULL DEFAULT '',
  created_by uuid,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_org_template_plans_org ON public.org_template_plans(organization_id, sport);
GRANT ALL ON public.org_template_plans TO service_role;
ALTER TABLE public.org_template_plans ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.org_template_plan_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.org_template_plans(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  move_id uuid,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  cue text NOT NULL DEFAULT '',
  why text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  target_kind text NOT NULL DEFAULT 'reps' CHECK (target_kind IN ('reps','minutes')),
  target_value numeric NOT NULL DEFAULT 10 CHECK (target_value > 0)
);
CREATE INDEX idx_org_template_plan_moves_tpl ON public.org_template_plan_moves(template_id, position);
GRANT ALL ON public.org_template_plan_moves TO service_role;
ALTER TABLE public.org_template_plan_moves ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.org_template_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.org_template_plans(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  coach_id uuid NOT NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.plans(id) ON DELETE SET NULL,
  deployed_by uuid,
  deployed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, coach_id)
);
CREATE INDEX idx_org_template_deployments_org ON public.org_template_deployments(organization_id);
GRANT ALL ON public.org_template_deployments TO service_role;
ALTER TABLE public.org_template_deployments ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_org_template_plans_updated_at BEFORE UPDATE ON public.org_template_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();