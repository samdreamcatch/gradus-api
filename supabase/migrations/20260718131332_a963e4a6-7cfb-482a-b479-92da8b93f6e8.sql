
-- 1. Extend resources table
ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS coach_id uuid REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'pdf',
  ADD COLUMN IF NOT EXISTS external_url text,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

ALTER TABLE public.resources ALTER COLUMN storage_path DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.resources
    ADD CONSTRAINT resources_kind_check CHECK (kind IN ('pdf','image','link'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.resources
    ADD CONSTRAINT resources_kind_payload_check CHECK (
      (kind = 'link' AND external_url IS NOT NULL AND storage_path IS NULL)
      OR (kind IN ('pdf','image') AND storage_path IS NOT NULL AND external_url IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS resources_coach_id_idx ON public.resources(coach_id) WHERE coach_id IS NOT NULL;

-- 2. resource_sports join table
CREATE TABLE IF NOT EXISTS public.resource_sports (
  resource_id uuid NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE,
  sport text NOT NULL,
  PRIMARY KEY (resource_id, sport)
);

GRANT SELECT, INSERT, DELETE ON public.resource_sports TO authenticated;
GRANT ALL ON public.resource_sports TO service_role;

ALTER TABLE public.resource_sports ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS resource_sports_sport_idx ON public.resource_sports(sport);

-- Backfill sports from existing resources
INSERT INTO public.resource_sports (resource_id, sport)
SELECT id, sport FROM public.resources
ON CONFLICT DO NOTHING;

-- 3. Grants on resources (may already be set; safe to re-run)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resources TO authenticated;
GRANT ALL ON public.resources TO service_role;

-- 4. Helper predicates
CREATE OR REPLACE FUNCTION public.parent_has_coach_upload(_resource_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.resources r
    JOIN public.resource_sports rs ON rs.resource_id = r.id
    JOIN public.coach_athletes ca ON ca.coach_id = r.coach_id
    JOIN public.athletes a ON a.id = ca.athlete_id
    JOIN public.parent_profiles pp ON pp.id = a.parent_id
    LEFT JOIN public.athlete_goals g ON g.athlete_id = a.id AND g.sport = rs.sport
    LEFT JOIN public.coach_athlete_sports cas ON cas.athlete_id = a.id AND cas.sport = rs.sport
    WHERE r.id = _resource_id
      AND r.coach_id IS NOT NULL
      AND pp.user_id = auth.uid()
      AND (g.athlete_id IS NOT NULL OR cas.athlete_id IS NOT NULL)
  );
$$;

CREATE OR REPLACE FUNCTION public.athlete_has_coach_upload(_resource_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.resources r
    JOIN public.resource_sports rs ON rs.resource_id = r.id
    JOIN public.coach_athletes ca ON ca.coach_id = r.coach_id
    JOIN public.athletes a ON a.id = ca.athlete_id
    JOIN public.athlete_goals g ON g.athlete_id = a.id AND g.sport = rs.sport
    WHERE r.id = _resource_id
      AND r.coach_id IS NOT NULL
      AND a.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.caller_is_resource_owner(_coach_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coach_profiles
    WHERE id = _coach_id AND user_id = auth.uid()
  );
$$;

-- 5. Rewrite resources RLS to include coach uploads
DROP POLICY IF EXISTS "Parents read resources for their athletes' sports" ON public.resources;

CREATE POLICY "Parents read library and roster coach uploads"
  ON public.resources FOR SELECT TO authenticated
  USING (
    (coach_id IS NULL AND published = true AND public.parent_has_athlete_in_sport(sport))
    OR (coach_id IS NOT NULL AND public.parent_has_coach_upload(id))
  );

CREATE POLICY "Athletes read roster coach uploads"
  ON public.resources FOR SELECT TO authenticated
  USING (
    coach_id IS NOT NULL AND public.athlete_has_coach_upload(id)
  );

CREATE POLICY "Coaches read their own uploads"
  ON public.resources FOR SELECT TO authenticated
  USING (
    coach_id IS NOT NULL AND public.caller_is_resource_owner(coach_id)
  );

CREATE POLICY "Pro/Club coaches insert their own uploads"
  ON public.resources FOR INSERT TO authenticated
  WITH CHECK (
    coach_id IS NOT NULL
    AND public.caller_is_resource_owner(coach_id)
    AND public.coach_effective_tier(coach_id) IN ('coach_pro','club')
  );

CREATE POLICY "Pro/Club coaches update their own uploads"
  ON public.resources FOR UPDATE TO authenticated
  USING (
    coach_id IS NOT NULL
    AND public.caller_is_resource_owner(coach_id)
  )
  WITH CHECK (
    coach_id IS NOT NULL
    AND public.caller_is_resource_owner(coach_id)
    AND public.coach_effective_tier(coach_id) IN ('coach_pro','club')
  );

CREATE POLICY "Coaches delete their own uploads"
  ON public.resources FOR DELETE TO authenticated
  USING (
    coach_id IS NOT NULL AND public.caller_is_resource_owner(coach_id)
  );

-- 6. resource_sports RLS: mirror parent resource visibility
CREATE POLICY "Read sport tags with resource"
  ON public.resource_sports FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.resources r WHERE r.id = resource_sports.resource_id)
  );

CREATE POLICY "Owner coach writes sport tags"
  ON public.resource_sports FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.resources r
      WHERE r.id = resource_sports.resource_id
        AND r.coach_id IS NOT NULL
        AND public.caller_is_resource_owner(r.coach_id)
    )
    AND EXISTS (
      SELECT 1 FROM public.resources r
      JOIN public.coach_levels cl ON cl.coach_id = r.coach_id
      WHERE r.id = resource_sports.resource_id
        AND cl.sport = resource_sports.sport
    )
  );

CREATE POLICY "Owner coach deletes sport tags"
  ON public.resource_sports FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.resources r
      WHERE r.id = resource_sports.resource_id
        AND r.coach_id IS NOT NULL
        AND public.caller_is_resource_owner(r.coach_id)
    )
  );

-- 7. Storage policies on resource-pdfs bucket for coach uploads
-- Path convention: coach/<coach_id>/<uuid>.<ext>
CREATE POLICY "Pro/Club coach uploads to own folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'resource-pdfs'
    AND (storage.foldername(name))[1] = 'coach'
    AND EXISTS (
      SELECT 1 FROM public.coach_profiles cp
      WHERE cp.user_id = auth.uid()
        AND cp.id::text = (storage.foldername(name))[2]
        AND public.coach_effective_tier(cp.id) IN ('coach_pro','club')
    )
  );

CREATE POLICY "Coach reads own uploads"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'resource-pdfs'
    AND (storage.foldername(name))[1] = 'coach'
    AND EXISTS (
      SELECT 1 FROM public.coach_profiles cp
      WHERE cp.user_id = auth.uid()
        AND cp.id::text = (storage.foldername(name))[2]
    )
  );

CREATE POLICY "Coach deletes own uploads"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'resource-pdfs'
    AND (storage.foldername(name))[1] = 'coach'
    AND EXISTS (
      SELECT 1 FROM public.coach_profiles cp
      WHERE cp.user_id = auth.uid()
        AND cp.id::text = (storage.foldername(name))[2]
    )
  );
