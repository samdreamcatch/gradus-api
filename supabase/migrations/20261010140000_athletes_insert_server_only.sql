-- Only the server creates athlete rows.
--
-- "Adults can insert own self-managed athlete row" (20260707221730) checked
-- only self_managed = true, parent_id IS NULL and user_id = auth.uid().
-- Anyone signed in could therefore call the API directly with their own
-- session and insert a row with any other values: an 8- or 14-year-old
-- already account_state 'active' with guardian_claimed_at set, a claim token
-- they chose, or is_test. That skips the provisional state and verified-
-- guardian claim a 13–17 self sign-up waits on (decision #31), and the
-- parent-only rule for under-13s (decision #30). "Parents can insert own
-- athletes" checked only that parent_id is the caller's own profile, so a
-- parent could create a child with fields the server never sets on a new
-- child: another person's user_id, a username, account_state,
-- guardian_claimed_at or is_test.
--
-- No signed-in code path relied on either policy. Every app insert into
-- athletes runs as the service role. The one exception was
-- createSelfManagedAthlete, which moves to the admin client in the same
-- change. Revoking INSERT also covers any INSERT policy that exists outside
-- this repo.
--
-- Rollout: Publish the app change before applying this migration. The new
-- code works with or without it; the old code's sign-up insert fails once it
-- is applied.

DROP POLICY IF EXISTS "Adults can insert own self-managed athlete row" ON public.athletes;
DROP POLICY IF EXISTS "Parents can insert own athletes" ON public.athletes;

REVOKE INSERT ON public.athletes FROM anon, authenticated;

DO $$
BEGIN
  IF has_any_column_privilege('anon', 'public.athletes', 'INSERT')
     OR has_any_column_privilege('authenticated', 'public.athletes', 'INSERT') THEN
    RAISE EXCEPTION 'anon or authenticated can still insert into public.athletes';
  END IF;
END;
$$;
