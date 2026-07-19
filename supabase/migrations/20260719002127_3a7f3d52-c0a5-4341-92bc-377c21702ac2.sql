-- Soft-delete tracking (does not touch existing table RLS)
CREATE TABLE IF NOT EXISTS public.soft_deleted_users (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.soft_deleted_users TO authenticated;
GRANT ALL ON public.soft_deleted_users TO service_role;
ALTER TABLE public.soft_deleted_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage soft deletes"
  ON public.soft_deleted_users FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Org admin flag on coach_profiles
ALTER TABLE public.coach_profiles
  ADD COLUMN IF NOT EXISTS is_org_admin BOOLEAN NOT NULL DEFAULT false;

-- Admin-attached promo codes on a per-user basis
CREATE TABLE IF NOT EXISTS public.user_applied_promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code TEXT NOT NULL REFERENCES public.promo_codes(code) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('next_checkout', 'active_now')),
  environment TEXT CHECK (environment IS NULL OR environment IN ('sandbox','live')),
  stripe_subscription_id TEXT,
  applied_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, code, scope)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_applied_promo_codes TO authenticated;
GRANT ALL ON public.user_applied_promo_codes TO service_role;
ALTER TABLE public.user_applied_promo_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage applied promo codes"
  ON public.user_applied_promo_codes FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can read their own applied promo codes"
  ON public.user_applied_promo_codes FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS user_applied_promo_codes_user_id_idx
  ON public.user_applied_promo_codes (user_id);
CREATE INDEX IF NOT EXISTS user_applied_promo_codes_code_idx
  ON public.user_applied_promo_codes (code);