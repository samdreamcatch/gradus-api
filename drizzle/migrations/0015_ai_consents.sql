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