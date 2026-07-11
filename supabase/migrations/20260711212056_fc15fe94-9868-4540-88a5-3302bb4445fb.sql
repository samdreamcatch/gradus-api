ALTER TABLE public.athletes ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS athletes_is_test_idx ON public.athletes(is_test) WHERE is_test = true;