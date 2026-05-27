
-- 1. Link athletes to an auth user (nullable until they claim their invite)
ALTER TABLE public.athletes
  ADD COLUMN IF NOT EXISTS user_id uuid UNIQUE,
  ADD COLUMN IF NOT EXISTS phone text;

CREATE INDEX IF NOT EXISTS idx_athletes_phone ON public.athletes(phone);

-- 2. Invite-code lifecycle: expiry + claim tracking
ALTER TABLE public.athlete_invite_codes
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_athlete_invite_codes_code ON public.athlete_invite_codes(code);

-- 3. OTP challenges (server-only — no client access)
CREATE TABLE IF NOT EXISTS public.athlete_otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  code_hash text NOT NULL,
  invite_code text,
  expires_at timestamptz NOT NULL,
  attempts smallint NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_athlete_otp_phone ON public.athlete_otp_challenges(phone, created_at DESC);

GRANT ALL ON public.athlete_otp_challenges TO service_role;
-- Intentionally NO grants to anon or authenticated — only supabaseAdmin touches this.

ALTER TABLE public.athlete_otp_challenges ENABLE ROW LEVEL SECURITY;
-- No policies = no access for anon/authenticated even if grants were added.

-- 4. Athletes can read/update their own row once linked
CREATE POLICY "Athletes can view own row"
  ON public.athletes
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Athletes can update own row"
  ON public.athletes
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);
