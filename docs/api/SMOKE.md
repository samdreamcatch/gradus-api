# /api/v1 auth broker — supervised smoke test

Production is the only Supabase environment, so this runs against it, under
supervision, once per change to the auth broker. Two ways to run it.

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
