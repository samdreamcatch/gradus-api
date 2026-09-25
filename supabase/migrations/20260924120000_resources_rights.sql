-- Rights status for the curated Gradus library (rows with coach_id IS NULL).
--
-- App Store Connect asks whether the app shows third-party content and
-- whether Gradus holds the rights (PRD §12 #16; docs/ios/app-store-submission.md
-- §6). Mariah's call (2026-09-24): the iOS 1.0 library shows only documents
-- Gradus authored or holds a licence for. Every existing curated row starts
-- as 'pending' (hidden from the store app until marked); the web library is
-- unchanged. Coach uploads never consult this column: the coach owns them.
--
--   gradus    Written by Gradus Sports.
--   licensed  Public licence or written permission on file.
--   pending   Rights not confirmed; shown on the web only.
ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS rights text NOT NULL DEFAULT 'pending';

DO $$ BEGIN
  ALTER TABLE public.resources
    ADD CONSTRAINT resources_rights_check CHECK (rights IN ('gradus', 'licensed', 'pending'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.resources.rights IS
  'Curated library only: gradus | licensed | pending. The iOS app lists curated rows only when gradus or licensed.';
