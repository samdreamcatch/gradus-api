-- Retention policy, milestone S5 (PRD §6.13 A9; decisions #41–#43, Mariah
-- 2026-10-03; reworked after the 2026-10-04 review). The daily
-- consent-retention hook gains two sweeps:
--   1. Dormant under-18 athlete accounts: no activity for 36 months → every
--      guardian on file is emailed, and 30 days (plus one day of grace)
--      later the account is deleted unless anyone did anything on it.
--      `retention_notice_sent_at` records the notice so it is sent once and
--      the deletion waits for it; `retention_checked_at` records each
--      examination so the batch rotates through candidates least-recently-
--      checked first and old active accounts cannot starve the rest.
--   2. Records that outlive an account (webhook receipts, deletion
--      tombstones) are deleted after 5 years. No schema change needed.
ALTER TABLE public.athletes
  ADD COLUMN IF NOT EXISTS retention_notice_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS retention_checked_at timestamptz;

COMMENT ON COLUMN public.athletes.retention_notice_sent_at IS
  'When the dormant-account notice went to the guardians on file; cleared by any activity; the deletion runs 31 days after it (retention policy).';
COMMENT ON COLUMN public.athletes.retention_checked_at IS
  'When the dormant sweep last examined this row; candidates are taken least-recently-checked first.';

-- The sweep prefilters on account age and birthdate, never on updated_at
-- (its own stamps bump it), and orders by the check stamp.
CREATE INDEX IF NOT EXISTS athletes_retention_scan_idx
  ON public.athletes (retention_checked_at ASC NULLS FIRST, created_at ASC);

-- Only the server writes the two stamps (the verification-columns pattern):
-- a parent or athlete could otherwise back-date a notice or stuff the batch.
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
