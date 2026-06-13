
-- 1. Relax NOT NULL on coach_id for parent-owned rows
ALTER TABLE public.parent_profiles ALTER COLUMN coach_id DROP NOT NULL;
ALTER TABLE public.athlete_goals ALTER COLUMN coach_id DROP NOT NULL;
ALTER TABLE public.athlete_lesson_slots ALTER COLUMN coach_id DROP NOT NULL;

-- 2. Parent invite codes
CREATE TABLE public.parent_invite_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL UNIQUE REFERENCES public.parent_profiles(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (code ~ '^[A-Z2-9]{8}$')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.parent_invite_codes TO authenticated;
GRANT ALL ON public.parent_invite_codes TO service_role;

ALTER TABLE public.parent_invite_codes ENABLE ROW LEVEL SECURITY;

-- Parent can read & manage their own row
CREATE POLICY "Parents read own invite code"
  ON public.parent_invite_codes FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.parent_profiles pp
    WHERE pp.id = parent_invite_codes.parent_id AND pp.user_id = auth.uid()
  ));

CREATE POLICY "Parents insert own invite code"
  ON public.parent_invite_codes FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.parent_profiles pp
    WHERE pp.id = parent_invite_codes.parent_id AND pp.user_id = auth.uid()
  ));

CREATE POLICY "Parents update own invite code"
  ON public.parent_invite_codes FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.parent_profiles pp
    WHERE pp.id = parent_invite_codes.parent_id AND pp.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.parent_profiles pp
    WHERE pp.id = parent_invite_codes.parent_id AND pp.user_id = auth.uid()
  ));

-- 3. Public lookup RPC so a coach (or pre-signup visitor via server function)
-- can resolve a code to a parent's display name + athlete count without
-- exposing user_id or other fields.
CREATE OR REPLACE FUNCTION public.get_parent_by_invite_code(_code text)
RETURNS TABLE (
  parent_id uuid,
  first_name text,
  last_name text,
  athlete_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pp.id,
    pp.first_name,
    pp.last_name,
    (SELECT COUNT(*)::int FROM public.athletes a WHERE a.parent_id = pp.id)
  FROM public.parent_invite_codes pic
  JOIN public.parent_profiles pp ON pp.id = pic.parent_id
  WHERE pic.code = upper(_code)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_parent_by_invite_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_parent_by_invite_code(text) TO authenticated, service_role;
