CREATE TABLE public.organization_sports (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sport text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, sport)
);
GRANT ALL ON public.organization_sports TO service_role;
ALTER TABLE public.organization_sports ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.org_move_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  seed_move_id uuid NOT NULL REFERENCES public.seed_moves(id) ON DELETE CASCADE,
  name text,
  category text,
  description text,
  cue text,
  why text,
  default_target_kind text CHECK (default_target_kind IN ('reps','mins')),
  default_target_value numeric,
  archived_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (organization_id, seed_move_id)
);
GRANT ALL ON public.org_move_overrides TO service_role;
ALTER TABLE public.org_move_overrides ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.org_resource_overrides (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE,
  title text,
  description text,
  archived_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (organization_id, resource_id)
);
GRANT ALL ON public.org_resource_overrides TO service_role;
ALTER TABLE public.org_resource_overrides ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.org_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sport text NOT NULL,
  level_key text NOT NULL,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  practice_hours_per_week numeric NOT NULL DEFAULT 0,
  is_custom boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, sport, level_key)
);
GRANT ALL ON public.org_levels TO service_role;
ALTER TABLE public.org_levels ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.resource_ack_requirements (
  resource_id uuid PRIMARY KEY REFERENCES public.resources(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  audiences text[] NOT NULL DEFAULT '{}' CHECK (audiences <@ ARRAY['coach','parent','athlete']::text[]),
  version integer NOT NULL DEFAULT 1,
  required_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT ALL ON public.resource_ack_requirements TO service_role;
ALTER TABLE public.resource_ack_requirements ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.resource_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  version integer NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('coach','parent','athlete')),
  signer_name text NOT NULL DEFAULT '',
  acted_for_athlete_id uuid,
  acknowledged_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX resource_acknowledgements_once
  ON public.resource_acknowledgements (resource_id, version, user_id, coalesce(acted_for_athlete_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX resource_acknowledgements_org ON public.resource_acknowledgements (organization_id, resource_id);
GRANT SELECT, INSERT ON public.resource_acknowledgements TO service_role;
ALTER TABLE public.resource_acknowledgements ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.resource_acknowledgements_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Acknowledgements cannot be changed or removed';
END;
$$;
CREATE TRIGGER resource_acknowledgements_no_change
  BEFORE UPDATE OR DELETE ON public.resource_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION public.resource_acknowledgements_append_only();