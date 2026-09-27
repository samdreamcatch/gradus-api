-- Mark the curated library as store-safe (follows 20260924120000_resources_rights).
--
-- Mariah, 2026-09-26 (first TestFlight pass, where a parent's Resources tab
-- showed no Gradus library at all because every curated row was still
-- 'pending'): every document in the curated library is content she wrote,
-- except The Athlete Survivors' Assist PDFs, which Gradus uses with the
-- Assist's written permission. So:
--
--   * Assist rows       -> 'licensed'
--   * every other row   -> 'gradus'
--   * new rows default  -> 'gradus' (curated rows are hers unless marked
--     otherwise in Admin -> Content -> Library rights)
--
-- Only rows still 'pending' are touched, so anything already marked by hand
-- keeps its value. Coach uploads (coach_id IS NOT NULL) never read this column.
UPDATE public.resources
SET rights = CASE
    WHEN coalesce(external_url, '') ILIKE '%athletesurvivorsassist%'
      OR coalesce(storage_path, '') ILIKE '%athlete%survivor%'
      OR title ILIKE '%survivors%assist%'
      OR title ILIKE '%the assist%'
      OR description ILIKE '%athlete survivors%'
    THEN 'licensed'
    ELSE 'gradus'
  END,
  updated_at = now()
WHERE coach_id IS NULL
  AND rights = 'pending';

ALTER TABLE public.resources ALTER COLUMN rights SET DEFAULT 'gradus';

COMMENT ON COLUMN public.resources.rights IS
  'Curated library only: gradus | licensed | pending. The iOS app lists curated rows only when gradus or licensed. Defaults to gradus (2026-09-26).';
