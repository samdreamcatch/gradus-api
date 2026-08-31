-- Gradus Live Board — public competition scoreboards.
--
-- Nothing here is personal data: the payload mirrors results USFS already
-- publishes, so both tables are readable by anonymous visitors (the board is
-- reached by scanning a QR code on a rink sign, with no account).

CREATE TABLE IF NOT EXISTS public.competitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  ijs_base_url text NOT NULL,
  comp_id text NOT NULL,
  year integer NOT NULL,
  name text NOT NULL DEFAULT '',
  dates_label text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  starts_on date,
  ends_on date,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.competitions TO anon;
GRANT SELECT ON public.competitions TO authenticated;
GRANT ALL ON public.competitions TO service_role;

ALTER TABLE public.competitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read competitions"
  ON public.competitions FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE TABLE IF NOT EXISTS public.competition_snapshots (
  competition_id uuid PRIMARY KEY REFERENCES public.competitions(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  venues jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz,
  refreshing_at timestamptz,
  error text,
  fetch_count integer NOT NULL DEFAULT 0,
  view_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.competition_snapshots TO anon;
GRANT SELECT ON public.competition_snapshots TO authenticated;
GRANT ALL ON public.competition_snapshots TO service_role;

ALTER TABLE public.competition_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read competition snapshots"
  ON public.competition_snapshots FOR SELECT
  TO anon, authenticated
  USING (true);
