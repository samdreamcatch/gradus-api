
CREATE TABLE public.client_errors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('client','server')),
  message TEXT NOT NULL,
  stack TEXT,
  route TEXT,
  user_id UUID,
  user_email TEXT,
  user_role TEXT,
  user_name TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX client_errors_created_at_idx ON public.client_errors (created_at DESC);
CREATE INDEX client_errors_user_id_idx ON public.client_errors (user_id);

GRANT SELECT ON public.client_errors TO authenticated;
GRANT ALL ON public.client_errors TO service_role;

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all errors"
  ON public.client_errors
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
