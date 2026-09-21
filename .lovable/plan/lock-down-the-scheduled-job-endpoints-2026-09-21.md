# Lock down the scheduled-job endpoints

Two findings came in. One is real and worth fixing; the other needs no code change.

## 1. Scheduled-job endpoints are effectively open (real — fix this)

Seven background endpoints check the caller against the app's *public* key —
the same key shipped inside every visitor's browser. Anyone who copies it can
trigger these jobs at will:

- trial-ending billing reminders
- internal error digest
- lifecycle welcome/activation emails
- lesson reminders
- lesson wrap-up prompts
- competition recap prompts
- voice-note transcripts

Impact: an outsider could repeatedly fire real emails to coaches and parents,
burn send-provider quota, and spam internal alerting. No data is exposed, but
the send volume is real.

### The fix

Switch all seven to the private backend key, which is never sent to browsers —
the same check the email-queue job already uses.

The scheduled jobs that call them get updated in the same change so nothing
breaks. They will read the private key from the database's encrypted vault at
call time (a copy is already stored there under
`email_queue_service_role_key`), so the key never appears in any file.

Four jobs are currently scheduled and will be rewritten: billing notices
(daily), error digest (hourly), lifecycle emails (every 5 min). The remaining
endpoints have no live job yet; their route files are still hardened so they
are safe when scheduled.

### Technical detail

- In `src/routes/api/public/hooks/*.ts` (7 files), replace the
  `apikey !== publishable` comparison with a constant-time comparison against
  `process.env.SUPABASE_SERVICE_ROLE_KEY`, read from the `apikey` header or the
  `Authorization: Bearer` header. Drop the now-unused `publishable` lookup and
  its misconfiguration branch.
- One migration re-schedules the live `cron.job` entries so the header is built
  with `jsonb_build_object('apikey', (select decrypted_secret from
  vault.decrypted_secrets where name = 'email_queue_service_role_key'))`
  instead of a literal anon key. Schedules and bodies are unchanged; no new
  cron cadence is introduced.
- Verify afterwards with a query on `cron.job` (headers no longer contain the
  anon key) and by confirming `net._http_response` shows 200s, not 401s, on the
  next run.

## 2. Roster link tampering (no change needed)

Verified in the migrations: `coach_athletes` has a RESTRICTIVE policy blocking
all updates for signed-in and anonymous users, and roster changes go through
insert/delete only. Trusted backend code intentionally bypasses row rules, as
it does everywhere. The finding itself says "informational only". It will be
marked as not applicable rather than changed.
