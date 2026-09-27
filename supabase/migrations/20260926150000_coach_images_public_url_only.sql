-- Coach resources: images come only from a publicly available web address,
-- never from the coach's device (camera roll photos may show minors).
-- File uploads are PDF only. Existing uploaded images keep working.

-- 1. An image may now be a link (external_url) as well as a stored file.
ALTER TABLE public.resources DROP CONSTRAINT IF EXISTS resources_kind_payload_check;
ALTER TABLE public.resources
  ADD CONSTRAINT resources_kind_payload_check CHECK (
    (kind = 'link' AND external_url IS NOT NULL AND storage_path IS NULL)
    OR (kind = 'pdf' AND storage_path IS NOT NULL AND external_url IS NULL)
    OR (kind = 'image' AND (external_url IS NULL) <> (storage_path IS NULL))
  );

-- 2. No new coach image may be a stored file, and a coach's stored file must
--    be a PDF they uploaded: in their own folder, stored as application/pdf
--    (so image bytes behind a .pdf name can't be served as an image).
--    A trigger rather than a CHECK so the coach images already uploaded stay
--    valid and still open.
CREATE OR REPLACE FUNCTION public.refuse_coach_image_upload()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.coach_id IS NULL OR NEW.storage_path IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.kind = 'image' THEN
    RAISE EXCEPTION 'Coach images must be a link to a publicly available image, not an upload'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.storage_path NOT LIKE ('coach/' || NEW.coach_id::text || '/%')
     OR NEW.storage_path LIKE '%..%'
     OR NOT EXISTS (
       SELECT 1 FROM storage.objects o
       WHERE o.bucket_id = 'resource-pdfs'
         AND o.name = NEW.storage_path
         AND lower(split_part(o.metadata->>'mimetype', ';', 1)) = 'application/pdf'
     ) THEN
    RAISE EXCEPTION 'A coach resource file must be a PDF the coach uploaded'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.refuse_coach_image_upload() FROM PUBLIC;

DROP TRIGGER IF EXISTS resources_refuse_coach_image_upload ON public.resources;
CREATE TRIGGER resources_refuse_coach_image_upload
  BEFORE INSERT OR UPDATE OF kind, storage_path, coach_id ON public.resources
  FOR EACH ROW EXECUTE FUNCTION public.refuse_coach_image_upload();

-- 3. A coach's own storage folder takes PDFs only.
DROP POLICY IF EXISTS "Pro/Club coach uploads to own folder" ON storage.objects;
CREATE POLICY "Pro/Club coach uploads to own folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'resource-pdfs'
    AND (storage.foldername(name))[1] = 'coach'
    AND lower(storage.extension(name)) = 'pdf'
    AND EXISTS (
      SELECT 1 FROM public.coach_profiles cp
      WHERE cp.user_id = auth.uid()
        AND cp.id::text = (storage.foldername(name))[2]
        AND public.coach_effective_tier(cp.id) IN ('coach_pro','club')
    )
  );
