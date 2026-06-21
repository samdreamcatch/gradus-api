
-- Enable citext for case-insensitive email matching
CREATE EXTENSION IF NOT EXISTS citext;

-- Role enum
CREATE TYPE public.app_role AS ENUM ('admin');

-- user_roles table
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can read own roles"
  ON public.user_roles
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- has_role helper (security definer to bypass RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Allowlist of emails that should auto-become admins on signup
CREATE TABLE public.admin_allowlist (
  email citext PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.admin_allowlist TO service_role;

ALTER TABLE public.admin_allowlist ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role can read/write.

INSERT INTO public.admin_allowlist (email)
VALUES ('mariah@gradussports.com'), ('alyson@gradussports.com')
ON CONFLICT (email) DO NOTHING;

-- Auto-grant admin on signup when email is in the allowlist
CREATE OR REPLACE FUNCTION public.grant_admin_if_allowlisted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.admin_allowlist
    WHERE email = NEW.email::citext
  ) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER grant_admin_on_signup
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.grant_admin_if_allowlisted();

-- Backfill any existing allowlisted users
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin'::public.app_role
FROM auth.users u
WHERE u.email IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.admin_allowlist a WHERE a.email = u.email::citext)
ON CONFLICT (user_id, role) DO NOTHING;
