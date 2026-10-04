ALTER TABLE public.athletes
  ADD COLUMN IF NOT EXISTS retention_notice_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS retention_checked_at timestamptz;

COMMENT ON COLUMN public.athletes.retention_notice_sent_at IS
  'When the dormant-account notice went to the guardians on file; cleared by any activity; the deletion runs 31 days after it (retention policy).';
COMMENT ON COLUMN public.athletes.retention_checked_at IS
  'When the dormant sweep last examined this row; candidates are taken least-recently-checked first.';

CREATE INDEX IF NOT EXISTS athletes_retention_scan_idx
  ON public.athletes (retention_checked_at ASC NULLS FIRST, created_at ASC);

CREATE OR REPLACE FUNCTION public.protect_athlete_retention_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.is_service_caller() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.retention_notice_sent_at IS NOT NULL OR NEW.retention_checked_at IS NOT NULL THEN
      RAISE EXCEPTION 'Retention fields on athletes can only be set by the server'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.retention_notice_sent_at IS DISTINCT FROM OLD.retention_notice_sent_at
     OR NEW.retention_checked_at IS DISTINCT FROM OLD.retention_checked_at THEN
    RAISE EXCEPTION 'Retention fields on athletes can only be set by the server'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_athlete_retention_columns ON public.athletes;
CREATE TRIGGER protect_athlete_retention_columns
  BEFORE INSERT OR UPDATE ON public.athletes
  FOR EACH ROW EXECUTE FUNCTION public.protect_athlete_retention_columns();