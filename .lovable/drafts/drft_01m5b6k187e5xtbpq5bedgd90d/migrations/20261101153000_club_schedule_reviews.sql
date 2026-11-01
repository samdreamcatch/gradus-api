-- Review storage only. Saving an import never sends an invitation or adds a lesson.
CREATE TABLE public.org_schedule_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  file_name text NOT NULL,
  uploaded_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'review' CHECK (status IN ('review', 'ready')),
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);
GRANT SELECT ON public.org_schedule_imports TO authenticated;
GRANT ALL ON public.org_schedule_imports TO service_role;
ALTER TABLE public.org_schedule_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Club admins read schedule imports" ON public.org_schedule_imports
  FOR SELECT TO authenticated USING (public.has_org_admin(auth.uid(), organization_id));

CREATE TABLE public.org_schedule_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  import_id uuid NOT NULL,
  row_no integer NOT NULL,
  review_row jsonb NOT NULL,
  FOREIGN KEY (import_id, organization_id) REFERENCES public.org_schedule_imports(id, organization_id),
  UNIQUE (import_id, row_no)
);
GRANT SELECT ON public.org_schedule_import_rows TO authenticated;
GRANT ALL ON public.org_schedule_import_rows TO service_role;
ALTER TABLE public.org_schedule_import_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Club admins read schedule rows" ON public.org_schedule_import_rows
  FOR SELECT TO authenticated USING (public.has_org_admin(auth.uid(), organization_id));

CREATE FUNCTION public.club_save_schedule_review(p_org uuid, p_user uuid, p_file text, p_rows jsonb, p_ready boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid;
BEGIN
  IF NOT public.has_org_admin(p_user, p_org) THEN RAISE EXCEPTION 'Not authorized for this club'; END IF;
  PERFORM id FROM public.organizations WHERE id = p_org FOR UPDATE;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Import requires 1 to 500 rows';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) r
    WHERE r->>'coachId' IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.org_seats s JOIN public.coach_profiles c ON c.id = s.coach_id
      WHERE s.organization_id = p_org AND c.organization_id = p_org AND s.coach_id::text = r->>'coachId'
    )
  ) THEN RAISE EXCEPTION 'Coach no longer holds a club seat'; END IF;
  INSERT INTO public.org_schedule_imports(organization_id, file_name, uploaded_by, status, counts)
    VALUES(p_org, p_file, p_user, CASE WHEN p_ready THEN 'ready' ELSE 'review' END,
      jsonb_build_object('lessons', jsonb_array_length(p_rows), 'coaches',
        (SELECT count(DISTINCT r->>'coachId') FROM jsonb_array_elements(p_rows) r))) RETURNING id INTO new_id;
  INSERT INTO public.org_schedule_import_rows(organization_id, import_id, row_no, review_row)
    SELECT p_org, new_id, ordinality::integer, value FROM jsonb_array_elements(p_rows) WITH ORDINALITY;
  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION public.club_save_schedule_review(uuid, uuid, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_save_schedule_review(uuid, uuid, text, jsonb, boolean) TO service_role;