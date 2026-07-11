CREATE TABLE public.adult_athlete_invite_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL UNIQUE REFERENCES public.athletes(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT adult_athlete_invite_codes_code_format
    CHECK (code ~ '^[A-Z2-9]{8}$')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.adult_athlete_invite_codes TO authenticated;
GRANT ALL ON public.adult_athlete_invite_codes TO service_role;

ALTER TABLE public.adult_athlete_invite_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Adult athletes can view their own invite code"
  ON public.adult_athlete_invite_codes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.athletes a
      WHERE a.id = adult_athlete_invite_codes.athlete_id
        AND a.user_id = auth.uid()
        AND a.self_managed = true
    )
  );

CREATE POLICY "Adult athletes can insert their own invite code"
  ON public.adult_athlete_invite_codes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.athletes a
      WHERE a.id = adult_athlete_invite_codes.athlete_id
        AND a.user_id = auth.uid()
        AND a.self_managed = true
    )
  );

CREATE POLICY "Adult athletes can update their own invite code"
  ON public.adult_athlete_invite_codes
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.athletes a
      WHERE a.id = adult_athlete_invite_codes.athlete_id
        AND a.user_id = auth.uid()
        AND a.self_managed = true
    )
  );

CREATE OR REPLACE FUNCTION public.get_adult_athlete_by_invite_code(_code text)
RETURNS TABLE(athlete_id uuid, first_name text, last_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.first_name, a.last_name
  FROM public.adult_athlete_invite_codes aic
  JOIN public.athletes a ON a.id = aic.athlete_id
  WHERE aic.code = upper(_code)
    AND a.self_managed = true
  LIMIT 1;
$$;
