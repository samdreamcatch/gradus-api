CREATE TABLE public.impersonation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,
  admin_email text,
  target_user_id uuid NOT NULL,
  target_email text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX impersonation_events_created_at_idx ON public.impersonation_events (created_at DESC);

GRANT SELECT ON public.impersonation_events TO authenticated;
GRANT ALL ON public.impersonation_events TO service_role;

ALTER TABLE public.impersonation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view impersonation events"
  ON public.impersonation_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));