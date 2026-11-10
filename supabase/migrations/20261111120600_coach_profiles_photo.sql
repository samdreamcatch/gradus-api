-- A coach's profile photo (src/lib/coach-photo.server.ts), shown on their
-- marketplace profile. photo_url holds the object's authenticated Storage URL
-- in the private coach-photos bucket below,
-- `<SUPABASE_URL>/storage/v1/object/authenticated/coach-photos/<coach id>/<file>`.
-- Optional: NULL until the coach adds one (initials show), and on every
-- existing row.
--
-- The column rides on the existing table grants and RLS policies on
-- coach_profiles. The marketplace only ever hands out a signed link for a path
-- inside the coach's own folder, so a value written some other way is ignored.
ALTER TABLE public.coach_profiles
  ADD COLUMN IF NOT EXISTS photo_url text;

ALTER TABLE public.coach_profiles DROP CONSTRAINT IF EXISTS coach_profiles_photo_url_check;
ALTER TABLE public.coach_profiles
  ADD CONSTRAINT coach_profiles_photo_url_check CHECK (
    photo_url IS NULL OR char_length(photo_url) BETWEEN 1 AND 2048
  );

COMMENT ON COLUMN public.coach_profiles.photo_url IS
  'The coach''s profile photo: its Storage URL in the private coach-photos bucket (.../object/authenticated/coach-photos/<coach id>/<file>). Set by PUT /api/v1/coach/profile/photo; NULL when there is none.';

-- ---------- Storage: private coach-photos bucket ----------
-- Path convention: {coach_profiles.id}/{file}. Up to 5 MB.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'coach-photos',
  'coach-photos',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO NOTHING;

-- Whether `_user_id` is the coach whose folder this is. Takes the folder as
-- text so a malformed path is "no", not an error.
CREATE OR REPLACE FUNCTION public.is_coach_photo_owner(_folder text, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.coach_profiles cp
    WHERE cp.id::text = _folder
      AND cp.user_id = _user_id
  )
$$;

REVOKE ALL ON FUNCTION public.is_coach_photo_owner(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_coach_photo_owner(text, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Coaches read own photo" ON storage.objects;
CREATE POLICY "Coaches read own photo"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'coach-photos'
  AND public.is_coach_photo_owner((storage.foldername(name))[1], auth.uid())
);

DROP POLICY IF EXISTS "Coaches upload own photo" ON storage.objects;
CREATE POLICY "Coaches upload own photo"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'coach-photos'
  AND public.is_coach_photo_owner((storage.foldername(name))[1], auth.uid())
);

DROP POLICY IF EXISTS "Coaches replace own photo" ON storage.objects;
CREATE POLICY "Coaches replace own photo"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'coach-photos'
  AND public.is_coach_photo_owner((storage.foldername(name))[1], auth.uid())
)
WITH CHECK (
  bucket_id = 'coach-photos'
  AND public.is_coach_photo_owner((storage.foldername(name))[1], auth.uid())
);

DROP POLICY IF EXISTS "Coaches delete own photo" ON storage.objects;
CREATE POLICY "Coaches delete own photo"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'coach-photos'
  AND public.is_coach_photo_owner((storage.foldername(name))[1], auth.uid())
);
