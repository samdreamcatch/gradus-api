-- Coach uploads with pictures are held for review (Mariah, 2026-10-11).
--
-- Gradus never keeps photos or video of athletes. Coach files are PDFs only
-- (20260926150000), but a PDF can carry pictures. The server now checks every
-- coach PDF before athletes or parents can see it (resource-file-check.server.ts):
-- a PDF with any embedded picture, or one it can't read with confidence, is
-- held until a person at Gradus releases it in Admin → Uploads to review. No
-- AI and no outside service looks at the file.
--
-- review_state:
--   released       visible to the coach's athletes and parents (the default,
--                  and the only state for links, the library and org rows)
--   pending_check  stored, not yet checked by the server; hidden
--   held           has pictures (or couldn't be read); hidden until released
-- A rejected file is deleted with its row, so "rejected" is not a state.

-- 1. The state, and who released it.
ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS review_state text NOT NULL DEFAULT 'released',
  ADD COLUMN IF NOT EXISTS review_reason text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.resources DROP CONSTRAINT IF EXISTS resources_review_state_check;
ALTER TABLE public.resources
  ADD CONSTRAINT resources_review_state_check
  CHECK (review_state IN ('released', 'pending_check', 'held'));

CREATE INDEX IF NOT EXISTS idx_resources_review_queue
  ON public.resources (review_state, created_at)
  WHERE review_state <> 'released';

-- 2. Files already stored. Coach images uploaded before 2026-09-26 are held
--    for a person to look at; every coach PDF is checked again by the server
--    (the daily consent-retention hook, or "Check now" in Admin).
UPDATE public.resources
   SET review_state = 'held', review_reason = 'stored_image'
 WHERE coach_id IS NOT NULL AND storage_path IS NOT NULL AND kind = 'image';

UPDATE public.resources
   SET review_state = 'pending_check', review_reason = NULL
 WHERE coach_id IS NOT NULL AND storage_path IS NOT NULL AND kind = 'pdf';

-- 3. Only the server sets the state. A coach writing the row directly gets
--    pending_check for any stored file, and can't change the state later.
-- SECURITY INVOKER on purpose (like protect_coach_billing_columns): under
-- SECURITY DEFINER, current_user would be the owner and is_service_caller()
-- would wave every coach through.
CREATE OR REPLACE FUNCTION public.guard_resource_review_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.is_service_caller() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.review_state := CASE
      WHEN NEW.coach_id IS NOT NULL AND NEW.storage_path IS NOT NULL THEN 'pending_check'
      ELSE 'released'
    END;
    NEW.review_reason := NULL;
    NEW.reviewed_at := NULL;
    NEW.reviewed_by := NULL;
  ELSE
    IF NEW.storage_path IS DISTINCT FROM OLD.storage_path
       AND NEW.coach_id IS NOT NULL AND NEW.storage_path IS NOT NULL THEN
      NEW.review_state := 'pending_check';
      NEW.review_reason := NULL;
      NEW.reviewed_at := NULL;
      NEW.reviewed_by := NULL;
    ELSE
      NEW.review_state := OLD.review_state;
      NEW.review_reason := OLD.review_reason;
      NEW.reviewed_at := OLD.reviewed_at;
      NEW.reviewed_by := OLD.reviewed_by;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_resource_review_state() FROM PUBLIC;

DROP TRIGGER IF EXISTS resources_guard_review_state ON public.resources;
CREATE TRIGGER resources_guard_review_state
  BEFORE INSERT OR UPDATE ON public.resources
  FOR EACH ROW EXECUTE FUNCTION public.guard_resource_review_state();

-- 4. Athletes and parents see a coach upload only once it is released.
DROP POLICY IF EXISTS "Parents read library and roster coach uploads" ON public.resources;
CREATE POLICY "Parents read library and roster coach uploads"
  ON public.resources FOR SELECT TO authenticated
  USING (
    (coach_id IS NULL AND published = true AND public.parent_has_athlete_in_sport(sport))
    OR (coach_id IS NOT NULL AND review_state = 'released' AND public.parent_has_coach_upload(id))
  );

DROP POLICY IF EXISTS "Athletes read roster coach uploads" ON public.resources;
CREATE POLICY "Athletes read roster coach uploads"
  ON public.resources FOR SELECT TO authenticated
  USING (
    coach_id IS NOT NULL AND review_state = 'released' AND public.athlete_has_coach_upload(id)
  );

-- 5. Files reach storage only through a server-signed upload link (web and
--    iOS both use one), never a direct insert, so every stored file has gone
--    through the server. The coach keeps read on their own folder.
DROP POLICY IF EXISTS "Pro/Club coach uploads to own folder" ON storage.objects;

--    Nor can a coach delete a stored file directly: with delete, a coach
--    could remove a released PDF and upload another file to the same path
--    with the signed link (valid two hours), and the row would stay
--    released. Deleting a resource goes through the server (service role),
--    and the daily sweep removes uploads no resource points at.
DROP POLICY IF EXISTS "Coach deletes own uploads" ON storage.objects;

--    Parents read files only through a link the server signs after RLS on
--    resources has allowed the row (getResourceSignedUrl), as athletes
--    always have. The old direct-read policy matched any published row in
--    the parent's sports, so it ignored review_state and reached other
--    coaches' files.
DROP POLICY IF EXISTS "Parents read resource PDFs for their athletes' sports" ON storage.objects;

-- 6. Ask Gradus quotes a coach PDF only once it is released.
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  query_embedding extensions.vector(1536),
  p_sport text,
  p_coach_ids uuid[],
  p_limit integer
)
RETURNS TABLE (
  chunk_id uuid,
  source_id uuid,
  title text,
  publisher text,
  edition text,
  section text,
  page integer,
  content text,
  quote_allowed boolean,
  resource_id uuid,
  external_url text,
  similarity double precision
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT
    c.id,
    s.id,
    s.title,
    s.publisher,
    s.edition,
    c.section,
    c.page,
    c.content,
    s.quote_allowed,
    s.resource_id,
    s.external_url,
    1 - (c.embedding <=> query_embedding)
  FROM public.knowledge_chunks c
  JOIN public.knowledge_sources s ON s.id = c.source_id
  WHERE c.embedding IS NOT NULL
    AND s.status = 'ready'
    AND (c.sport = 'all' OR c.sport = p_sport)
    AND (c.coach_id IS NULL OR c.coach_id = ANY (COALESCE(p_coach_ids, ARRAY[]::uuid[])))
    AND (
      s.resource_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.resources r
        WHERE r.id = s.resource_id AND r.review_state = 'released'
      )
    )
  ORDER BY c.embedding <=> query_embedding
  LIMIT GREATEST(1, LEAST(p_limit, 50));
$$;

REVOKE ALL ON FUNCTION public.match_knowledge_chunks(extensions.vector, text, uuid[], integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(extensions.vector, text, uuid[], integer)
  TO service_role;

-- 7. Stored coach files that no resource points at (an upload whose resource
--    was never created): the server deletes them through the storage API.
CREATE OR REPLACE FUNCTION public.orphan_coach_upload_paths(p_older_than interval, p_limit integer)
RETURNS TABLE (name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT o.name
  FROM storage.objects o
  WHERE o.bucket_id = 'resource-pdfs'
    AND o.name LIKE 'coach/%'
    AND o.created_at < now() - p_older_than
    AND NOT EXISTS (SELECT 1 FROM public.resources r WHERE r.storage_path = o.name)
  ORDER BY o.created_at
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$$;

REVOKE ALL ON FUNCTION public.orphan_coach_upload_paths(interval, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.orphan_coach_upload_paths(interval, integer) TO service_role;
