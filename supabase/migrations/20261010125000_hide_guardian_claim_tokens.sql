-- Hide the guardian claim credentials from every client role.
--
-- athletes.guardian_claim_token is the secret behind /g/<token> and
-- athletes.guardian_claim_code is its typed-in twin. Whoever holds either can
-- claim the athlete as their parent or guardian (guardian-claim.server.ts),
-- and claiming does not check the claimer's email. Until now any role that
-- passes a SELECT policy on athletes could read both columns through
-- PostgREST with its own JWT: a coach for every rostered athlete, a parent or
-- linked guardian for their athletes, and a self-signed-up 13-17 athlete for
-- their own row ("Athletes can view own row", created by the reverted
-- 20260527020340 migration, is still live). A coach could read the token of
-- a child whose real parent's email is on file and claim the child from a
-- parent account before that parent opened the invite email. This closes the
-- read path only: whoever chooses the guardian email (the adding coach, a
-- self-signing-up teen, a resend) still decides where the link is sent.
--
-- Every server path that reads, matches or mints these columns uses
-- supabaseAdmin (service_role), which this does not touch. No client or
-- RLS-client code selects them.
--
-- A column REVOKE is a no-op while the role still holds table-level SELECT,
-- and the default privileges grant table-level ALL on every public table to
-- anon and authenticated. So: revoke table-level SELECT, then grant SELECT
-- back on every other column. The column list is read from the catalog when
-- the migration runs, so it also covers any column production has that the
-- repo's migrations don't. Expected today (21): id, parent_id, first_name,
-- created_at, updated_at, user_id, last_name, birthdate, motivation,
-- username, self_managed, promo_code, is_test, guardian_email,
-- guardian_invited_at, guardian_claimed_at, added_by_coach_id,
-- invite_recipient, account_state, retention_notice_sent_at,
-- retention_checked_at.
--
-- Only SELECT changes. INSERT stays: the 13-17 self sign-up
-- (adult-athlete.server.ts) writes guardian_claim_token through the
-- athlete's own RLS client and reads back only the id.
--
-- From now on:
--   * A new column on public.athletes is NOT readable by the app's signed-in
--     clients until a migration grants it:
--       GRANT SELECT (new_column) ON public.athletes TO anon, authenticated;
--     src/lib/athletes-column-grants.test.ts fails a migration that forgets.
--   * select("*") on athletes from an RLS client fails with "permission
--     denied for table athletes". Name the columns.
--   * Any RLS policy that reads these columns in a subquery must do it
--     through a SECURITY DEFINER helper.

REVOKE SELECT ON public.athletes FROM anon, authenticated;

DO $$
DECLARE
  readable text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum)
    INTO readable
    FROM pg_attribute
   WHERE attrelid = 'public.athletes'::regclass
     AND attnum > 0
     AND NOT attisdropped
     AND attname NOT IN ('guardian_claim_token', 'guardian_claim_code');

  EXECUTE format('GRANT SELECT (%s) ON public.athletes TO anon, authenticated', readable);
END $$;

-- Fail loudly rather than leave the credentials readable (for example through
-- a grant to PUBLIC), or leave any other column unreadable.
DO $$
DECLARE
  r text;
  c text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOR c IN
      SELECT attname FROM pg_attribute
       WHERE attrelid = 'public.athletes'::regclass AND attnum > 0 AND NOT attisdropped
    LOOP
      IF c IN ('guardian_claim_token', 'guardian_claim_code') THEN
        IF has_column_privilege(r, 'public.athletes', c, 'SELECT') THEN
          RAISE EXCEPTION 'athletes.% is still readable by %', c, r;
        END IF;
      ELSIF NOT has_column_privilege(r, 'public.athletes', c, 'SELECT') THEN
        RAISE EXCEPTION 'athletes.% is no longer readable by %', c, r;
      END IF;
    END LOOP;
  END LOOP;
END $$;
