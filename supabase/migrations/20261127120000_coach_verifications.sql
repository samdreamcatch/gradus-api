-- Coach verification (Marketplace scope: "Coach verification"; data entity
-- "Verification"). One row per coach: the identity check (Stripe Identity:
-- government ID plus a matching selfie), the SafeSport check, and an admin
-- override that always carries a recorded reason.
--
-- Only results and dates are kept here, never ID images or selfies: those
-- stay with the vendor (scope, Technical notes: "store only the result and
-- date"). Written only by the server (service role) from
-- src/lib/coach-verification.server.ts; a coach may read their own row.
--
-- Purely additive: no existing table or row changes.

CREATE TABLE IF NOT EXISTS public.coach_verifications (
  coach_id uuid PRIMARY KEY REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  vendor text NOT NULL DEFAULT 'stripe_identity',

  -- Identity: not_started → pending (a session is open or being processed)
  -- → passed | failed (with a reason the coach can act on).
  identity_status text NOT NULL DEFAULT 'not_started'
    CHECK (identity_status IN ('not_started', 'pending', 'passed', 'failed')),
  identity_session_id text,
  identity_failure_reason text,
  identity_checked_at timestamptz,

  -- SafeSport: recorded by an admin until a screening vendor is chosen;
  -- `next_recheck_at` is when it is due again (scope: regular re-checks).
  safesport_status text NOT NULL DEFAULT 'not_started'
    CHECK (safesport_status IN ('not_started', 'pending', 'passed', 'failed')),
  safesport_checked_at timestamptz,
  next_recheck_at timestamptz,

  -- An admin's override of the identity result, only with a reason
  -- (scope: "override them only with a recorded reason").
  override_status text CHECK (override_status IN ('passed', 'failed')),
  override_reason text,
  override_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  override_at timestamptz,
  CONSTRAINT coach_verifications_override_has_reason CHECK (
    override_status IS NULL OR length(btrim(coalesce(override_reason, ''))) > 0
  ),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coach_verifications_session
  ON public.coach_verifications (identity_session_id)
  WHERE identity_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coach_verifications_recheck
  ON public.coach_verifications (next_recheck_at)
  WHERE next_recheck_at IS NOT NULL;

DROP TRIGGER IF EXISTS update_coach_verifications_updated_at ON public.coach_verifications;
CREATE TRIGGER update_coach_verifications_updated_at
  BEFORE UPDATE ON public.coach_verifications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.coach_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Coaches read their own verification" ON public.coach_verifications;
CREATE POLICY "Coaches read their own verification"
  ON public.coach_verifications
  FOR SELECT
  TO authenticated
  USING (
    coach_id IN (SELECT id FROM public.coach_profiles WHERE user_id = auth.uid())
  );

-- No insert/update/delete policy: only the server writes, as the service role.
REVOKE ALL ON public.coach_verifications FROM PUBLIC, anon;
GRANT SELECT ON public.coach_verifications TO authenticated;
GRANT ALL ON public.coach_verifications TO service_role;

COMMENT ON TABLE public.coach_verifications IS
  'Coach marketplace verification results (identity via Stripe Identity, SafeSport) and admin overrides with a recorded reason. No ID images are stored.';
