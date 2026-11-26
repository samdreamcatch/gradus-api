-- A plan's cover video, beside its cover image (`media`). The marketplace shows the coach's
-- own image when there is one, else this video, else Gradus default artwork.
-- Same form as `media`: the authenticated Storage URL of an object in the plan's folder of
-- the private `plan-media` bucket
-- (`<SUPABASE_URL>/storage/v1/object/authenticated/plan-media/<plan id>/<file>.mp4`).
-- The bucket's existing folder-ownership policies cover video files too.

ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS media_video text;

COMMENT ON COLUMN public.plans.media_video IS
  'The plan''s optional cover video: its Supabase Storage URL in the plan-media bucket (.../object/authenticated/plan-media/<plan id>/<file>.mp4). Shown on the marketplace when the plan has no coach-uploaded image.';

-- Videos are compressed on the phone (60 s max) before upload; 50 MB covers that.
UPDATE storage.buckets
SET file_size_limit = 52428800,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime']
WHERE id = 'plan-media';
