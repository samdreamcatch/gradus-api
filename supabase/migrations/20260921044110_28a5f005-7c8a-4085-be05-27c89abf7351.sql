-- App Attest server plumbing (docs/ios/PRD.md §3.8, I15) — dormant,
-- log-only, never enforcing this wave.
--
-- Stores each device's DCAppAttestService public key after a
-- trust-on-first-use registration (POST /api/v1/auth/attest/register), so a
-- later request's signed assertion (checked by password.ts, log-only for
-- now) can be verified against it. Service-role-only: written and read
-- exclusively by src/lib/app-attest.server.ts through the admin client —
-- no end user or client ever queries this table directly.
--
-- `public_key` is the raw uncompressed EC point (0x04 || x || y, 65 bytes)
-- extracted from the attestation object's COSE_Key at registration time,
-- base64-encoded — not the original COSE/CBOR bytes; see
-- extractRawPublicKeyFromCose in app-attest.server.ts.
CREATE TABLE IF NOT EXISTS public.app_attest_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  key_id text NOT NULL UNIQUE,
  public_key text NOT NULL,
  sign_count bigint NOT NULL DEFAULT 0,
  team_id text NOT NULL,
  bundle_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('development', 'production')),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_attest_keys_user_id_idx ON public.app_attest_keys (user_id);

GRANT ALL ON public.app_attest_keys TO service_role;

ALTER TABLE public.app_attest_keys ENABLE ROW LEVEL SECURITY;
-- No policies for anon or authenticated: only the /api/v1 server layer
-- (service role) ever reads or writes App Attest key records.