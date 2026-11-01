-- Separate club identity from shared Gradus resource identity. Legacy evidence stays untouched.
CREATE TABLE public.club_resource_ack_requirements (
  resource_id uuid NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  audiences text[] NOT NULL DEFAULT '{}' CHECK (audiences <@ ARRAY['coach','parent','athlete']::text[]),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  required_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (organization_id, resource_id)
);
GRANT ALL ON public.club_resource_ack_requirements TO service_role;
ALTER TABLE public.club_resource_ack_requirements ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.club_resource_acknowledgements (
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
GRANT SELECT, INSERT ON public.club_resource_acknowledgements TO service_role;
ALTER TABLE public.club_resource_acknowledgements ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX club_resource_acknowledgements_once ON public.club_resource_acknowledgements
  (organization_id, resource_id, version, user_id, coalesce(acted_for_athlete_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX club_resource_acknowledgements_org ON public.club_resource_acknowledgements (organization_id, resource_id);
CREATE TRIGGER club_resource_acknowledgements_no_change BEFORE UPDATE OR DELETE ON public.club_resource_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION public.resource_acknowledgements_append_only();

CREATE TABLE public.club_policy_versions (
  organization_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  version integer NOT NULL,
  title text NOT NULL,
  audiences text[] NOT NULL,
  required_at timestamptz NOT NULL,
  storage_path text,
  external_url text,
  PRIMARY KEY (organization_id, resource_id, version)
);
GRANT SELECT, INSERT ON public.club_policy_versions TO service_role;
ALTER TABLE public.club_policy_versions ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER club_policy_versions_no_change BEFORE UPDATE OR DELETE ON public.club_policy_versions
  FOR EACH ROW EXECUTE FUNCTION public.resource_acknowledgements_append_only();

INSERT INTO public.club_resource_ack_requirements SELECT * FROM public.resource_ack_requirements;
INSERT INTO public.club_resource_acknowledgements SELECT * FROM public.resource_acknowledgements;
INSERT INTO public.club_policy_versions (organization_id, resource_id, version, title, audiences, required_at, storage_path, external_url)
SELECT q.organization_id, q.resource_id, q.version, r.title, q.audiences, q.required_at, r.storage_path, r.external_url
FROM public.resource_ack_requirements q JOIN public.resources r ON r.id = q.resource_id;

-- Serializes changes per club/document so concurrent "ask again" operations retain every version.
CREATE FUNCTION public.set_club_policy_requirement(p_org uuid, p_resource uuid, p_audiences text[], p_again boolean, p_actor uuid)
RETURNS integer LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v integer; stamp timestamptz; res public.resources%ROWTYPE;
BEGIN
  SELECT * INTO res FROM public.resources WHERE id = p_resource;
  IF NOT FOUND OR res.coach_id IS NOT NULL OR res.review_state <> 'released'
    OR NOT coalesce((res.organization_id = p_org AND res.is_org_template
      OR res.organization_id IS NULL AND res.published AND EXISTS (
        SELECT 1 FROM public.organization_sports s WHERE s.organization_id = p_org AND s.sport = res.sport)), false)
    OR EXISTS (SELECT 1 FROM public.org_resource_overrides o WHERE o.organization_id = p_org AND o.resource_id = p_resource AND o.archived_at IS NOT NULL)
  THEN RAISE EXCEPTION 'Document is not available for this club'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_resource::text, 0));
  SELECT version, required_at INTO v, stamp FROM public.club_resource_ack_requirements
    WHERE organization_id = p_org AND resource_id = p_resource FOR UPDATE;
  IF v IS NULL THEN v := 1; stamp := now();
  ELSIF p_again THEN v := v + 1; stamp := now(); END IF;
  INSERT INTO public.club_resource_ack_requirements VALUES (p_resource, p_org, p_audiences, v, stamp, p_actor)
    ON CONFLICT (organization_id, resource_id) DO UPDATE SET audiences = EXCLUDED.audiences,
      version = EXCLUDED.version, required_at = EXCLUDED.required_at, updated_by = EXCLUDED.updated_by;
  INSERT INTO public.club_policy_versions VALUES (p_org, p_resource, v, res.title, p_audiences, stamp, res.storage_path, res.external_url)
    ON CONFLICT DO NOTHING;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.set_club_policy_requirement(uuid,uuid,text[],boolean,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_club_policy_requirement(uuid,uuid,text[],boolean,uuid) TO service_role;
