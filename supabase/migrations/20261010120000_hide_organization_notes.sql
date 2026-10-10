-- Hide organizations.notes from every client role.
--
-- organizations.notes is the Gradus admins' private note on a club (the admin
-- Organizations page prompts for "Contract details, seat count, contact
-- person"). 20260719225511 meant to hide it with
--   REVOKE SELECT (notes) ON public.organizations FROM authenticated;
-- but authenticated still held table-level SELECT (20260715022253 granted it,
-- and nothing revoked it), so that statement did nothing. Any signed-in user
-- could read notes for every active org through PostgREST with their own JWT:
-- "Authenticated can read active organizations" lets every authenticated
-- user SELECT active rows. anon lost table-level SELECT in 20260717003314 and
-- has no SELECT policy, so it could not.
--
-- Every server path that reads or writes notes (listOrganizations,
-- createOrganization, updateOrganization in coach-org.functions.ts) uses
-- supabaseAdmin (service_role), which this does not touch. No client or
-- RLS-client code selects notes.
--
-- A column REVOKE is a no-op while the role still holds table-level SELECT,
-- and the default privileges grant table-level ALL on every public table to
-- anon and authenticated. So: revoke table-level SELECT, then grant SELECT
-- back on every other column. The column list is read from the catalog when
-- the migration runs, so it also covers any column production has that the
-- repo's migrations don't. Expected today (11): id, name, slug, active,
-- created_at, updated_at, city, region, logo_url, is_listed, content_version.
--
-- anon is revoked too, so production matches the repo even if a grant drifted
-- back, and gets no columns back: no policy or code path reads organizations
-- as anon.
--
-- Only SELECT changes. Admin writes go through supabaseAdmin.
--
-- From now on:
--   * A new column on public.organizations is NOT readable by the app's
--     signed-in clients until a migration grants it:
--       GRANT SELECT (new_column) ON public.organizations TO authenticated;
--     src/lib/organizations-column-grants.test.ts fails a migration that
--     forgets.
--   * select("*") on organizations (or an embedded organizations(*)) from an
--     RLS client fails with "permission denied for table organizations". Name
--     the columns.
--   * Any RLS policy that reads notes in a subquery must do it through a
--     SECURITY DEFINER helper.

REVOKE SELECT ON public.organizations FROM anon, authenticated;

DO $$
DECLARE
  readable text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum)
    INTO readable
    FROM pg_attribute
   WHERE attrelid = 'public.organizations'::regclass
     AND attnum > 0
     AND NOT attisdropped
     AND attname <> 'notes';

  EXECUTE format('GRANT SELECT (%s) ON public.organizations TO authenticated', readable);
END $$;

-- Fail loudly rather than leave notes readable (for example through a grant
-- to PUBLIC), or leave signed-in users unable to read a club's other columns.
DO $$
DECLARE
  r text;
  col name;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_column_privilege(r, 'public.organizations', 'notes', 'SELECT') THEN
      RAISE EXCEPTION 'organizations.notes is still readable by %', r;
    END IF;
  END LOOP;

  FOR col IN
    SELECT attname
      FROM pg_attribute
     WHERE attrelid = 'public.organizations'::regclass
       AND attnum > 0
       AND NOT attisdropped
       AND attname <> 'notes'
  LOOP
    IF NOT has_column_privilege('authenticated', 'public.organizations', col, 'SELECT') THEN
      RAISE EXCEPTION 'organizations.% is no longer readable by authenticated', col;
    END IF;
  END LOOP;
END $$;
