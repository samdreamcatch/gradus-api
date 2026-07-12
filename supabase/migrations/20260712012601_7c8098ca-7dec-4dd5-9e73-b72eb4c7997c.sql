CREATE TABLE public.email_template_overrides (
  template_name text NOT NULL,
  slot_key text NOT NULL,
  value text NOT NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (template_name, slot_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_template_overrides TO authenticated;
GRANT ALL ON public.email_template_overrides TO service_role;

ALTER TABLE public.email_template_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read email overrides" ON public.email_template_overrides FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert email overrides" ON public.email_template_overrides FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update email overrides" ON public.email_template_overrides FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete email overrides" ON public.email_template_overrides FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.email_template_override_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name text NOT NULL,
  slot_key text NOT NULL,
  value text NOT NULL,
  action text NOT NULL CHECK (action IN ('set', 'revert')),
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_template_override_history_lookup ON public.email_template_override_history (template_name, changed_at DESC);

GRANT SELECT, INSERT ON public.email_template_override_history TO authenticated;
GRANT ALL ON public.email_template_override_history TO service_role;

ALTER TABLE public.email_template_override_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read override history" ON public.email_template_override_history FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins write override history" ON public.email_template_override_history FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') AND changed_by = auth.uid());