CREATE TABLE public.user_blocks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  blocker_user_id uuid NOT NULL,
  blocked_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_blocks_not_self CHECK (blocker_user_id <> blocked_user_id),
  CONSTRAINT user_blocks_unique_pair UNIQUE (blocker_user_id, blocked_user_id)
);

CREATE INDEX user_blocks_blocked_idx ON public.user_blocks (blocked_user_id);

GRANT SELECT, INSERT, DELETE ON public.user_blocks TO authenticated;
GRANT ALL ON public.user_blocks TO service_role;

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own blocks"
  ON public.user_blocks FOR SELECT TO authenticated
  USING (blocker_user_id = auth.uid());

CREATE POLICY "Users can create their own blocks"
  ON public.user_blocks FOR INSERT TO authenticated
  WITH CHECK (blocker_user_id = auth.uid());

CREATE POLICY "Users can remove their own blocks"
  ON public.user_blocks FOR DELETE TO authenticated
  USING (blocker_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.users_blocked(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_user_id = _a AND blocked_user_id = _b)
       OR (blocker_user_id = _b AND blocked_user_id = _a)
  )
$$;

CREATE TABLE public.user_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reporter_user_id uuid NOT NULL,
  reported_user_id uuid NOT NULL,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN ('harassment','inappropriate','spam','minor_safety','other')),
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','actioned','dismissed')),
  admin_notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX user_reports_status_idx ON public.user_reports (status, created_at DESC);
CREATE INDEX user_reports_reporter_idx ON public.user_reports (reporter_user_id);

GRANT SELECT, INSERT ON public.user_reports TO authenticated;
GRANT ALL ON public.user_reports TO service_role;

ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reporters can view their own reports"
  ON public.user_reports FOR SELECT TO authenticated
  USING (reporter_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can file reports"
  ON public.user_reports FOR INSERT TO authenticated
  WITH CHECK (reporter_user_id = auth.uid() AND reported_user_id <> auth.uid());

CREATE POLICY "Admins can update reports"
  ON public.user_reports FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_user_reports_updated_at
  BEFORE UPDATE ON public.user_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();