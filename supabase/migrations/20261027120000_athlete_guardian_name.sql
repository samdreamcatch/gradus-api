-- A parent or guardian's name on the athlete row, before they claim.
--
-- The schedule-import review card (gradus-ios, decision 2026-10-21) asks
-- the coach "Under 18 / Over 18"; for a minor it takes the parent or
-- guardian's first and last name next to their email. Until the parent
-- claims the athlete there is no parent_profiles row to read a name from,
-- so the roster could only say "Parent" with no name. These two nullable
-- columns hold what the coach typed; once the parent claims, their own
-- profile name wins (coach-roster.server.ts prefers parent_profiles).
--
-- Written only by the server (service role) from the import commit. Readable
-- by signed-in clients the same way every other athletes column is: the
-- 20261010125000 migration revoked table-level SELECT, so each new column
-- needs its own GRANT (src/lib/athletes-column-grants.test.ts).
ALTER TABLE public.athletes
  ADD COLUMN IF NOT EXISTS guardian_first_name text,
  ADD COLUMN IF NOT EXISTS guardian_last_name text;

GRANT SELECT (guardian_first_name, guardian_last_name) ON public.athletes TO anon, authenticated;
