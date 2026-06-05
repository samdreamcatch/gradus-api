
-- Helper: does the signed-in parent have an athlete in this sport?
CREATE OR REPLACE FUNCTION public.parent_has_athlete_in_sport(_sport text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM athletes a
    JOIN parent_profiles pp ON pp.id = a.parent_id
    JOIN athlete_goals g ON g.athlete_id = a.id
    WHERE pp.user_id = auth.uid()
      AND g.sport = _sport
  );
$$;

-- Resources table
CREATE TABLE public.resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  storage_path text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.resources TO authenticated;
GRANT ALL ON public.resources TO service_role;

ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Parents read resources for their athletes' sports"
ON public.resources FOR SELECT
TO authenticated
USING (published = true AND public.parent_has_athlete_in_sport(sport));

CREATE TRIGGER update_resources_updated_at
BEFORE UPDATE ON public.resources
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX resources_sport_idx ON public.resources (sport, display_order);

-- Storage policies: read PDFs only when a published resource for a matching sport references them
CREATE POLICY "Parents read resource PDFs for their athletes' sports"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'resource-pdfs'
  AND EXISTS (
    SELECT 1 FROM public.resources r
    WHERE r.storage_path = storage.objects.name
      AND r.published = true
      AND public.parent_has_athlete_in_sport(r.sport)
  )
);
