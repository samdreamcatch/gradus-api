# Review: second Semgrep autofix PR (`current_setting('supabase.anon_key')`)

## Verdict: do not merge

This PR has the same two blocking problems as PR #40, and one of them is worse here because the failure would be silent.

## Verified findings

1. **`supabase.anon_key` does not exist on this project.** I queried the live database directly: `current_setting('supabase.anon_key', true)` returns null — the setting is not defined. The PR description's premise ("Supabase exposes the anon key as a PostgreSQL GUC") is not true for this instance. There is no such variable to read.

2. **The failure would be silent and delayed.** Unlike PR #40 (which would have failed loudly at migration time), this version stores the lookup *inside* the scheduled job body. Scheduling succeeds. Then every single run raises `unrecognized configuration parameter: "supabase.anon_key"` and does nothing. Nobody gets an error page. Welcome/activation emails and trial-ending notices just stop, and we would likely find out from a customer weeks later — exactly the failure mode we just spent a day chasing with Christine.

3. **It still edits migrations that have already been applied.** Rewriting a migration file does not change the running database. I checked `cron.job`: all three jobs still contain the original literal. So the PR again produces zero real remediation while making the repo disagree with production — and any future rebuild, branch, or restore would then produce the broken version described in point 2.

4. **Still incomplete.** The hourly `error-digest-hourly` job carries the same literal and is untouched, so even the cosmetic goal isn't met.

5. **Severity context worth recording.** The value flagged is the Supabase **publishable/anon** key. It is designed to be public — it already ships inside the browser bundle of every page load and is protected by row-level security, not by secrecy. Semgrep's rule (`detected-jwt-token`) matches on shape, not on sensitivity, so it cannot tell this apart from a real credential. This is a true positive for "a JWT is present" and a false positive for "a secret is exposed."

## Recommended disposition

- **Close this PR** (and keep #40 reverted).
- **Mark the Semgrep finding as accepted risk / low**, with the note in point 5. Semgrep autofix cannot see runtime database state, which is why both of its attempts produce SQL that looks right and cannot work here.
- **Optional cleanup, on our terms:** if we still want the literal out of the SQL, do it as one **new, forward-only** migration that
  - stores the key in Vault explicitly (with the value supplied at apply time, not read from a setting that doesn't exist),
  - re-schedules all three jobs — lifecycle-emails, billing-notices, and error-digest — to read from Vault,
  - and is verified straight afterward.

  This is housekeeping, not a security fix, so it can wait for a quiet moment.

## How to verify, if we do the cleanup

- Confirm the Vault secret exists and decrypts to the expected value before re-scheduling anything.
- After re-scheduling, watch each job's run history for successful runs and a 200 response on the outbound call — do not rely on "the migration applied cleanly," since that proves nothing here.
- Send a test signup and confirm the welcome/activation email lands, checking the email health dashboard for the send record.
- Confirm the next hourly error digest arrives.
- Keep a rollback ready: the previous working job definitions, so we can re-schedule them immediately if a run fails.
