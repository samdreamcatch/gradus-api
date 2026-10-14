-- Permission to use third-party AI (App Review 2026-10-12, Guidelines 5.1.1(i)
-- and 5.1.2(i)): before the app sends anything to an AI provider, it names
-- the provider and the data and asks the user. One row per account records
-- the answer. No row, or a row for an older `version`, means "not asked yet".
--
-- `version` changes when the list of providers or what they receive changes,
-- so everyone is asked again (src/lib/ai-consent.server.ts,
-- CURRENT_AI_CONSENT_VERSION).
--
-- The API checks `granted` before every AI request from the app; a voice note
-- sent from the app without permission is never transcribed.
--
-- Service role only: RLS on with no policies.
CREATE TABLE IF NOT EXISTS public.ai_consents (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted boolean NOT NULL,
  version text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_consents IS
  'Each account''s answer to the in-app AI permission screen (App Review 5.1.2(i)). Written and read by the server only.';

ALTER TABLE public.ai_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_consents FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_consents TO service_role;
