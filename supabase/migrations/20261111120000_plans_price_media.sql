-- Marketplace fields on plans, for `GET /api/v1/marketplace/plans`
-- (src/lib/marketplace-plans.server.ts), and a private bucket for plan images.
--
-- price: what a listing costs, in USD. Optional to write: it defaults to 0
-- (free), so every existing and new plan has one and the price filter never
-- meets a NULL.
--
-- media: the plan's one optional image, as the Supabase Storage URL of an
-- object in the private `plan-media` bucket below, in the authenticated form
-- `<SUPABASE_URL>/storage/v1/object/authenticated/plan-media/<plan id>/<file>`.
-- That URL doesn't expire (a signed URL would) and still goes through the
-- storage policies, so a client loads it with the signed-in user's token. The
-- listing never returns it: full content and media are for the plan's coach
-- (and, once purchases are recorded, its buyers) only.
--
-- Both columns ride on the existing table grants and RLS policies on plans:
-- the owning coach writes them, and the readers that can see a plan today can
-- see them.
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS price numeric(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS media text;

ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_price_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_price_check CHECK (price >= 0);

COMMENT ON COLUMN public.plans.price IS
  'Marketplace price in USD; 0 is free. Filtered by GET /api/v1/marketplace/plans.';
COMMENT ON COLUMN public.plans.media IS
  'The plan''s optional image: its Supabase Storage URL in the plan-media bucket (.../object/authenticated/plan-media/<plan id>/<file>). Never returned by the marketplace listing.';

-- The marketplace lists active plans and filters them by price.
CREATE INDEX IF NOT EXISTS plans_active_price_idx
  ON public.plans (price)
  WHERE status = 'active';

-- ---------- Storage: private plan-media bucket ----------
-- Path convention: {plan_id}/{file}. One image per plan, up to 10 MB.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'plan-media',
  'plan-media',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO NOTHING;

-- Whether `_user_id` is the coach who owns the plan named by a plan-media
-- folder. Takes the folder as text so a malformed path is "no", not an error.
CREATE OR REPLACE FUNCTION public.is_plan_media_owner(_folder text, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.plans p
    JOIN public.coach_profiles cp ON cp.id = p.coach_id
    WHERE p.id::text = _folder
      AND cp.user_id = _user_id
  )
$$;

REVOKE ALL ON FUNCTION public.is_plan_media_owner(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_plan_media_owner(text, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Plan coaches read plan media" ON storage.objects;
CREATE POLICY "Plan coaches read plan media"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'plan-media'
  AND public.is_plan_media_owner((storage.foldername(name))[1], auth.uid())
);

DROP POLICY IF EXISTS "Plan coaches upload plan media" ON storage.objects;
CREATE POLICY "Plan coaches upload plan media"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'plan-media'
  AND public.is_plan_media_owner((storage.foldername(name))[1], auth.uid())
);

DROP POLICY IF EXISTS "Plan coaches replace plan media" ON storage.objects;
CREATE POLICY "Plan coaches replace plan media"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'plan-media'
  AND public.is_plan_media_owner((storage.foldername(name))[1], auth.uid())
)
WITH CHECK (
  bucket_id = 'plan-media'
  AND public.is_plan_media_owner((storage.foldername(name))[1], auth.uid())
);

DROP POLICY IF EXISTS "Plan coaches delete plan media" ON storage.objects;
CREATE POLICY "Plan coaches delete plan media"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'plan-media'
  AND public.is_plan_media_owner((storage.foldername(name))[1], auth.uid())
);
