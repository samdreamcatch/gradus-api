# /api/v1 auth broker — supervised smoke test

Production is the only Supabase environment, so this runs against it, under
supervision, once per change to the auth broker. Two ways to run it.

## 0. Precheck: are the /api/v1 migrations applied?

Migration files that reach `main` through GitHub are **not applied by a Lovable publish**.
Confirmed 2026-09-05: after two publishes this query returned NULL for every relation and the
new limiter silently allowed everything; Mariah asked Lovable to apply the pending migrations,
and the query then returned all four. After every merge that adds a migration: ask Lovable to
apply pending migrations, then run this in the Lovable Cloud SQL editor (export to CSV if the
grid renders oddly):

```sql
select to_regclass('public.api_rate_limits')      as rate_limits,
       to_regclass('public.api_idempotency_keys') as idempotency,
       to_regclass('public.auth_identities')      as identities,
       to_regclass('public.board_follows')        as board_follows,
       to_regprocedure('public.find_confirmed_user_by_email(text)') as lookup_fn,
       to_regprocedure('public.protect_coach_billing_columns()')     as coach_guard,
       to_regprocedure('public.protect_parent_billing_columns()')    as parent_guard;
```

Every column must be non-null. If any is null, ask Lovable to apply the pending files in
`supabase/migrations`, then re-run the query.

**Version ordering.** Lovable only picks up migrations whose version (the leading timestamp)
is newer than the latest one it has already applied. A migration written on a branch and
merged later than a Lovable-generated one can therefore be "not pending" and never run:
`board_follows` (#61) was stamped `20260905061815`, merged after Lovable had applied
`20260905160000`, and was skipped (precheck returned NULL, "no pending migrations"). Before
merging a branch that adds a migration, check that its version is greater than the newest file
already on `main`; if not, rename it to the current UTC timestamp. Fix for an already-merged
file: rename it to a fresh version (the migrations are idempotent) and apply again. Public write routes fail closed
(`503 rate_limiter_unavailable`) when the limiter's table is unreachable, the error is logged as
`[api] rate limiter degraded` with the database error code, and the smoke script aborts at step
1b instead of passing quietly.

**Function privilege check** (run from any machine; the publishable key is public). A
service-role-only function must deny anonymous callers:

```bash
curl -s -w ' [%{http_code}]' -X POST -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY" -H "Authorization: Bearer $VITE_SUPABASE_PUBLISHABLE_KEY" -H 'Content-Type: application/json' -d '{"_email":"nobody@example.com"}' "$VITE_SUPABASE_URL/rest/v1/rpc/find_confirmed_user_by_email"
```

Expect `401` or `403` (permission denied). A `200` with `null` or a uuid means anyone can enumerate
accounts by email: apply `20260905160000_revoke_anon_execute_find_confirmed_user_by_email.sql`.

**Limiter probe from the outside** (no email is sent for an unknown address):

```bash
for i in $(seq 1 12); do curl -s -o /dev/null -w '%{http_code} ' -X POST -H 'Content-Type: application/json' -d '{"email":"smoke-nobody@example.com"}' https://gradus.training/api/v1/auth/recover; done; echo
```

Expect ten `200`s followed by `429`s. Twelve `200`s means the limiter is not working: turn the flag off.

**Billing-column guard check** (PRD §4.1 rule 13). Needs a signed-in coach's access token:
sign in to gradus.training as a coach, open devtools → Application → Local Storage →
`sb-<project-ref>-auth-token`, and copy the `access_token` value (never paste it into a chat
or a ticket; it is a live credential). With the token still on the clipboard:

```bash
scripts/smoke-guard-check.sh
```

It reads the token from the clipboard (a token is longer than the 1,024-character line limit
of a macOS terminal, so pasting it at a prompt drops the end), keeps it in-process, then expects
a 403 when setting your own `entitlement` and a 204 for a harmless `last_seen_at` update. If the guard is not active it
restores the original entitlement. If the token was ever exposed, sign out of gradus.training
in that browser afterwards; that revokes the refresh token.

Then, in Lovable preview (the server still writes these columns, now through the admin
client): open the coach Settings → plan status, start and abandon a checkout, and for a test
account run change plan, cancel, and a promo code; a new coach's first load must still create
the profile. Any "can only be changed by the server" error in those flows is a regression.

## Option A — local dev server against production (preferred; production stays dark)

Needs the project's service-role key in `.env.local` (git-ignored). Not `.env`: that file is tracked and Lovable-managed, so a key put there would be committed.

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
