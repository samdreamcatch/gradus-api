# Overnight brief — Phase 0.1: API v1 scaffolding

You are implementing work package **0.1** from `docs/ios/PRD.md`. Read these first, in this order: `CLAUDE.md`, PRD §4 (non-negotiable constraints), §6.2 (API design), §9.4 (backend rules). This brief narrows that scope for an unattended run; when the PRD says more than this brief, the brief wins.

## Ground rules (non-negotiable)

1. **Branch, never main.** Create `feat/api-v1-scaffold` from `main`. Never commit to `main`. Never merge. Finish by opening a pull request with `gh pr create` and stop.
2. **Additive only.** Do not modify any existing file except this allowed list: `package.json` (scripts and server-only dev dependencies), `bun.lock` (only via `bun install`), `.github/workflows/node.js.yml` (add one step), `.prettierignore` and `eslint.config.js` (only to ignore generated files), and `src/routeTree.gen.ts` (only by regeneration through `bun run build`, never by hand). Everything else you create is new: new files under `src/lib/api/`, `src/routes/api/v1/`, `supabase/migrations/`, `scripts/`, `docs/api/`, and tests.
3. **No web behavior change.** Nothing you add may be imported by existing code. Do not touch `src/lib/*.functions.ts`, `src/integrations/**`, existing migrations, components, styles, or existing routes.
4. **Off by default.** Every `/api/v1` route returns `503 {"error":{"code":"api_disabled"}}` unless `process.env.API_V1_ENABLED === "true"`.
5. **No secrets, no deploys.** Do not edit `.env*`, do not add secrets, do not run anything against Supabase or Lovable. Tests use fakes only.
6. **Green before PR.** `bun run lint`, `bun run typecheck`, `bun run build`, and `bun test` must all pass.
7. **When in doubt, stop smaller.** If the code you find conflicts with this brief, deliver the smaller safe scope and describe the conflict in the PR rather than improvising.

## Deliverables

### 1. Plumbing in `src/lib/api/`

- `errors.ts` — `ApiError { code, status, message, details? }` and `toResponse()`. JSON shape per PRD §6.2: `{"error":{"code","message","details"}}`. Map zod failures to `validation_failed` (400); map the existing roster-cap trigger message (starts with `Roster full:`, see `src/lib/roster-limits.ts`) to `roster_full` (409); unknown errors to `internal` (500) with no internal detail leaked.
- `auth.ts` — `authenticateRequest(request) → ApiContext { userId, supabase, admin }` using the same approach as `src/integrations/supabase/auth-middleware.ts` (Bearer token, user-scoped client, `auth.getClaims`). Copy the approach into this new file; do not import or change the middleware. `admin` is `supabaseAdmin` from `src/integrations/supabase/client.server.ts`. Public routes receive `ApiContext | null`.
- `client.ts` — parse `X-Gradus-Client` (`ios/1.4.0+87`) into `{ platform, version, build }`, tolerant of absence.
- `idempotency.ts` — `withIdempotency(ctx, key, run)` backed by table `api_idempotency_keys` through `ctx.admin`; scope by `(user_id, key)`; replay the stored status and body for 24 hours.
- `rate-limit.ts` — fixed-window limiter backed by table `api_rate_limits` through the admin client, keyed by route plus IP (and user when authenticated); returns 429 with `Retry-After`.
- `define-route.ts` — `defineApiRoute({ method, path, auth: "user" | "public", input?, output, idempotent?, rateLimit?, handler })` that returns the `server.handlers` object for a TanStack file route and handles, in order: kill switch → rate limit → auth → JSON parse → input validation → idempotency → handler → output validation → `Cache-Control: no-store` → error mapping. It also registers the route in the OpenAPI registry.
- `openapi.ts` — registry plus `buildOpenApiDocument()` producing OpenAPI 3.1 from the zod schemas. Use `zod-openapi` or `@asteasolutions/zod-to-openapi` as a **dev/server-only** dependency, imported only from `src/lib/api/` and `scripts/`.

Look at `src/routes/api/public/board/refresh.ts` for how raw file routes are written in this repo and follow that pattern.

### 2. Two additive migrations

New tables only; nothing about existing tables changes. Header comment explaining purpose. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, **no policies** for `anon` or `authenticated`, `GRANT ALL ... TO service_role` only.

- `api_idempotency_keys (user_id uuid not null, key text not null, response_status int not null, response_body jsonb not null, created_at timestamptz not null default now(), primary key (user_id, key))` with an index on `created_at`.
- `api_rate_limits (bucket text primary key, window_start timestamptz not null, count int not null default 0)`.

Add a pg_cron cleanup of idempotency rows older than 24 hours **only if** existing migrations already schedule pg_cron jobs (search `supabase/migrations` for `cron.schedule`); otherwise leave that as a noted TODO in the PR.

### 3. Four routes under `src/routes/api/v1/`

- `GET /api/v1/meta/config` (public) → `{ paywallEnabled, coachProEnabled, foundingCoachCutoff, termsVersion }` from `src/lib/paywall-flag.ts` and `src/lib/terms.ts`.
- `GET /api/v1/meta/client-policy` (public) → `{ minSupportedVersion: { ios: "0.0.0" }, message: null }` as constants for now.
- `POST /api/v1/me/presence` (user) → same effect as `touchLastSeen` in `src/lib/presence.functions.ts`. Read it and reproduce its update through `ctx.admin`; do not import the server function.
- `GET /api/v1/me/terms` (user) → same result as `getTermsStatus` in `src/lib/terms.functions.ts`, reproduced the same way.

### 4. OpenAPI generation

`scripts/openapi.ts` and a `package.json` script `openapi` that writes `docs/api/openapi.json`. Commit the generated file. Add one CI step after typecheck that runs the script and fails if `git diff --exit-code docs/api/openapi.json` shows changes.

### 5. Tests (`bun test`, fakes only)

Cover `define-route.ts`: kill switch → 503; missing or invalid bearer → 401; bad input → 400 with the error shape; idempotency replay returns the stored response and calls the handler once; rate limit → 429 with `Retry-After`; unknown error → 500 without leaking the message. Use an in-memory fake for the admin client. No network, no Supabase.

### 6. `docs/api/README.md` (under 60 lines)

Conventions summary pointing at PRD §6.2, and a worked example of adding a route with `defineApiRoute`.

### 7. Pull request

Title `feat(api): v1 scaffolding (meta, presence, terms)`. Description: what was added, every existing file touched and why, how to try it locally (`API_V1_ENABLED=true bun run dev`, then `curl` for the four routes with and without a bearer), and anything skipped with the reason. Do not merge.

## Out of scope tonight

Auth broker endpoints, the `/me` composite, extracting any `.functions.ts`, push, and any change to existing tables or to files outside the allowed list.
