# Review: PR #40 (remove hardcoded key from cron migrations)

## Short answer

Nothing is broken **right now** — but the change also didn't actually do anything, and it will break the scheduled emails the next time the database is rebuilt from migrations. It needs a follow-up before it can be considered done.

## What the PR did

It rewrote two already-applied migration files so the scheduled email jobs read the API key out of Vault instead of having it typed into the SQL, and added a new migration that puts the key into Vault.

## Findings (all verified against the live database)

1. **No live effect.** Editing a migration that already ran does not change the database. All three scheduled jobs in production still contain the original hardcoded key, exactly as before. Nothing about today's app behavior changed, so there is no live breakage and no live security improvement either.

2. **The Vault secret does not exist.** The new migration only creates it if a database setting named `app.settings.supabase_anon_key` is present. That setting is not configured on this project, so on a fresh database the migration would fail outright and stop the rest of the migration run.

3. **If it did run, the emails would stop.** The rewritten jobs look the key up from Vault. With no secret stored, they would send an empty key, and both endpoints reject an unmatched key — so welcome/activation emails and trial-ending notices would silently stop firing, with no error surfaced anywhere.

4. **One job was missed.** The hourly error-digest job still has the key hardcoded in its migration and wasn't touched, so the stated goal isn't fully met regardless.

5. **Rewriting applied migrations is itself the risk.** The file history no longer matches what actually ran. Any future rebuild, branch, or restore produces a different database than production.

## Recommended follow-up

1. Revert the two rewritten migration files back to their original content, so history matches the database that's actually running.
2. Delete the new Vault-seeding migration (it can't succeed as written).
3. If we still want the key out of the SQL — worth doing, just not this way — add one **new, forward-only** migration that:
   - stores the key in Vault directly rather than depending on a database setting that doesn't exist,
   - re-schedules all three jobs (welcome/activation, trial-ending, error digest) to read from Vault,
   - and is verified immediately after by checking that each job's next run succeeds.
4. Note for the security scanner: the key in question is the public/publishable key that already ships in the browser bundle. Moving it out of SQL is tidiness, not a leak fix — so this is not urgent.

## How to test

Once the follow-up lands, verification is quick and observable:

- **Scheduled-job health:** check each job's recent run history for successes rather than failures, and confirm the response status recorded for each outbound call.
- **Emails still flow:** trigger a signup on a test account and confirm the welcome/activation email lands, then check the email health dashboard in the admin panel for the send record.
- **Error digest:** confirm the hourly digest continues to arrive.
- **Fresh-database check:** the strongest test — run the full migration history from scratch on a scratch database and confirm it completes without error. That's the exact failure this PR would otherwise hide until the worst possible moment.

No app-facing UI is involved, so there's nothing for users to test in the browser.
