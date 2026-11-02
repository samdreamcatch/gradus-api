CREATE TABLE public.org_pdf_branding (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  primary_color text NOT NULL DEFAULT '#C0DD27' CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text NOT NULL DEFAULT '#6B7280' CHECK (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  heading_font text NOT NULL DEFAULT 'serif' CHECK (heading_font IN ('sans','serif','mono')),
  body_font text NOT NULL DEFAULT 'sans' CHECK (body_font IN ('sans','serif','mono')),
  header_text text NOT NULL DEFAULT '' CHECK (char_length(header_text) <= 120),
  footer_text text NOT NULL DEFAULT '' CHECK (char_length(footer_text) <= 200),
  logo_path text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.org_pdf_branding TO service_role;
ALTER TABLE public.org_pdf_branding ENABLE ROW LEVEL SECURITY;