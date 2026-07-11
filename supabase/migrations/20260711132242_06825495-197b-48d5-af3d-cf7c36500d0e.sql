-- Promo codes table
CREATE TABLE public.promo_codes (
  code text PRIMARY KEY CHECK (code = upper(code) AND length(code) BETWEEN 1 AND 32),
  label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.promo_codes TO authenticated;
GRANT ALL ON public.promo_codes TO service_role;

ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone signed in can read promo codes"
  ON public.promo_codes FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins can insert promo codes"
  ON public.promo_codes FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update promo codes"
  ON public.promo_codes FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete promo codes"
  ON public.promo_codes FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER promo_codes_set_updated_at
  BEFORE UPDATE ON public.promo_codes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Attribution columns
ALTER TABLE public.parent_profiles
  ADD COLUMN promo_code text REFERENCES public.promo_codes(code) ON DELETE SET NULL;

ALTER TABLE public.coach_profiles
  ADD COLUMN promo_code text REFERENCES public.promo_codes(code) ON DELETE SET NULL;

ALTER TABLE public.athletes
  ADD COLUMN promo_code text REFERENCES public.promo_codes(code) ON DELETE SET NULL;

CREATE INDEX parent_profiles_promo_code_idx ON public.parent_profiles(promo_code) WHERE promo_code IS NOT NULL;
CREATE INDEX coach_profiles_promo_code_idx ON public.coach_profiles(promo_code) WHERE promo_code IS NOT NULL;
CREATE INDEX athletes_promo_code_idx ON public.athletes(promo_code) WHERE promo_code IS NOT NULL;