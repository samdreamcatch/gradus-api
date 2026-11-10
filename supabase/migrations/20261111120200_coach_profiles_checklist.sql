-- The coach's setup checklist, for `GET`/`PATCH /api/v1/coach/profile`
-- (src/lib/coach-setup-checklist.server.ts): which of these steps the coach
-- has completed, as the app reports them, one step at a time.
--
--   identityVerification, payoutSetup, uploadProfilePhoto, saveFirstPlan
--
-- Every step is a boolean and starts false. The check keeps the column an
-- object holding only those four keys, each a boolean, so a bad write can't
-- reach it from any client.
--
-- The column rides on the existing table grants and RLS policies on
-- coach_profiles: the coach reads and updates their own row.
ALTER TABLE public.coach_profiles
  ADD COLUMN IF NOT EXISTS checklist jsonb NOT NULL DEFAULT jsonb_build_object(
    'identityVerification', false,
    'payoutSetup', false,
    'uploadProfilePhoto', false,
    'saveFirstPlan', false
  );

ALTER TABLE public.coach_profiles DROP CONSTRAINT IF EXISTS coach_profiles_checklist_check;
ALTER TABLE public.coach_profiles
  ADD CONSTRAINT coach_profiles_checklist_check CHECK (
    jsonb_typeof(checklist) = 'object'
    AND checklist - ARRAY['identityVerification', 'payoutSetup', 'uploadProfilePhoto', 'saveFirstPlan']
      = '{}'::jsonb
    AND NOT jsonb_path_exists(checklist, '$.* ? (@.type() != "boolean")')
  );

COMMENT ON COLUMN public.coach_profiles.checklist IS
  'Setup steps the coach has completed: identityVerification, payoutSetup, uploadProfilePhoto, saveFirstPlan (booleans). Written by PATCH /api/v1/coach/profile.';

-- Merges the steps in `_patch` into the caller's own checklist in one
-- statement, so two steps reported at the same moment both land. Runs as the
-- caller: RLS limits it to their own coach row. Returns the whole checklist,
-- or NULL when the caller has no coach profile.
CREATE OR REPLACE FUNCTION public.merge_coach_checklist(_patch jsonb)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.coach_profiles
  SET checklist = checklist || _patch
  WHERE user_id = auth.uid()
  RETURNING checklist
$$;

REVOKE ALL ON FUNCTION public.merge_coach_checklist(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_coach_checklist(jsonb) TO authenticated;
