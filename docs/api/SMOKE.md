# /api/v1 auth broker — supervised smoke test

Production is the only Supabase environment, so this runs against it, under
supervision, once per change to the auth broker. Two ways to run it.

## 0. Precheck: are the /api/v1 migrations applied?

Confirm every relation the API depends on exists before turning the flag on. Run this in the
Lovable Cloud SQL editor (the result grid may render headers oddly; export to CSV if unsure):

```sql
select to_regclass('public.api_rate_limits')      as rate_limits,
       to_regclass('public.api_idempotency_keys') as idempotency,
       to_regclass('public.auth_identities')      as identities,
       to_regprocedure('public.find_confirmed_user_by_email(text)') as lookup_fn;
```

Every column must be non-null. If any is null, ask Lovable to apply the pending files in
`supabase/migrations`, then re-run the query. On 2026-09-05 all four existed yet the limiter
still allowed everything, so existence is necessary, not sufficient: public write routes now
fail closed (`503 rate_limiter_unavailable`) whenever the limiter's table cannot be read or
written, the error is logged as `[api] rate limiter degraded` with the database error code, and
the smoke script aborts at step 1b instead of passing quietly. If step 1b aborts, ask Lovable
for the most recent `[api] rate limiter degraded` log lines; they name the cause.

**Limiter probe from the outside** (no email is sent for an unknown address):

```bash
for i in $(seq 1 12); do curl -s -o /dev/null -w '%{http_code} ' -X POST -H 'Content-Type: application/json' -d '{"email":"smoke-nobody@example.com"}' https://gradus.training/api/v1/auth/recover; done; echo
```

Expect ten `200`s followed by `429`s. Twelve `200`s means the limiter is not working: turn the flag off.

## Option A — local dev server against production (preferred; production stays dark)

Needs the project's service-role key in the local `.env` (never commit it).

```bash
API_V1_ENABLED=true bun run dev                       # terminal 1
BASE_URL=http://localhost:8080 SIGNUP_EMAIL=you+smoke1@example.com scripts/smoke-api-v1.sh   # terminal 2
bun scripts/smoke-mint-session.ts alyson.stemas@gmail.com   # session-minting path (Apple/Google use it)
```

## Option B — production with the flag on briefly

1. Merge the auth-broker PR and publish (routes stay dark: no flag, 503).
2. In Lovable Cloud secrets set `API_V1_ENABLED=true`; republish if `/api/v1/meta/config` still returns 503.
3. `BASE_URL=https://gradus.training SIGNUP_EMAIL=you+smoke1@example.com scripts/smoke-api-v1.sh`
4. Set the flag back off and republish. The session-minting path is exercised by the first
   native Google sign-in in milestone I1 instead (it needs a real identity token).

## What the script proves

Kill switch state · public metadata · 401s where required · password sign-in for the demo
coach and the token working on protected routes · generic 401 for wrong or unknown
credentials · optional username sign-in · username lookups · recovery email (captcha bypass)
· optional coach sign-up honoring auto-confirm · per-identifier rate limit (429 within 11 tries).

## What it cannot prove yet

`/auth/apple` and `/auth/google` end to end (need a real identity token: Apple enrollment,
Google iOS client ID), and Apple token revocation on deletion (needs the Sign in with Apple
key). Both are covered by the first supervised native sign-in in I1.

## While the flag is on

Sign in on the web, send a message, open a plan. Nothing should differ; the web never calls
`/api/v1`. Passwords typed into the script are read silently and never logged or printed.
