ALTER TABLE public.client_errors
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'production'
    CHECK (environment IN ('production', 'preview'));

CREATE INDEX IF NOT EXISTS client_errors_env_created_idx
  ON public.client_errors (environment, created_at DESC);