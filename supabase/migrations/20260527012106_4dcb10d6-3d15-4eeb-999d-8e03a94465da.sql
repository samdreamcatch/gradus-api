-- Restrict coach_invite_codes policies to authenticated role (not anon/public)
DROP POLICY IF EXISTS "Coaches can view own invite code" ON public.coach_invite_codes;
DROP POLICY IF EXISTS "Coaches can insert own invite code" ON public.coach_invite_codes;
DROP POLICY IF EXISTS "Coaches can update own invite code" ON public.coach_invite_codes;
DROP POLICY IF EXISTS "Coaches can delete own invite code" ON public.coach_invite_codes;

CREATE POLICY "Coaches can view own invite code"
  ON public.coach_invite_codes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.coach_profiles cp WHERE cp.id = coach_invite_codes.coach_id AND cp.user_id = auth.uid()));

CREATE POLICY "Coaches can insert own invite code"
  ON public.coach_invite_codes FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.coach_profiles cp WHERE cp.id = coach_invite_codes.coach_id AND cp.user_id = auth.uid()));

CREATE POLICY "Coaches can update own invite code"
  ON public.coach_invite_codes FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.coach_profiles cp WHERE cp.id = coach_invite_codes.coach_id AND cp.user_id = auth.uid()));

CREATE POLICY "Coaches can delete own invite code"
  ON public.coach_invite_codes FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.coach_profiles cp WHERE cp.id = coach_invite_codes.coach_id AND cp.user_id = auth.uid()));

-- Revoke anon access to coach_invite_codes (auth-only table)
REVOKE ALL ON public.coach_invite_codes FROM anon;

-- Add explicit restrictive UPDATE policy on coach_athletes
-- (link rows are immutable once created; coaches/parents can only insert or delete)
CREATE POLICY "No updates to coach_athletes links"
  ON public.coach_athletes AS RESTRICTIVE FOR UPDATE TO authenticated, anon
  USING (false) WITH CHECK (false);
