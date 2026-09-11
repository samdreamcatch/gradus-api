# Gradus API v1

Conventions are defined in `docs/ios/PRD.md` §6.2 (request/response rules) and
§9.4 (backend rules). This is a summary, not a replacement — read those first.

## Conventions

- **Location.** File routes under `src/routes/api/v1/**`, built on shared
  plumbing in `src/lib/api/`.
- **Kill switch.** Every route is a 503 (`api_disabled`) unless
  `API_V1_ENABLED=true`.
- **Auth.** `Authorization: Bearer <Supabase access token>`. `auth: "user"`
  routes require it (401 otherwise); `auth: "public"` routes get
  `ApiContext | null`.
- **Errors.** `{"error": {"code", "message", "details"}}` with stable
  snake_case codes. See `src/lib/api/errors.ts`.
  Pipeline codes: `api_disabled` (503), `unauthenticated` (401),
  `validation_failed` (400), `rate_limited` (429),
  `rate_limiter_unavailable` (503), `payload_too_large` (413),
  `idempotency_key_reused` / `idempotency_key_in_progress` (409),
  `roster_full` (409), `internal` (500). Common domain codes: `not_found`
  (404), `forbidden` / `wrong_role` / `plan_required` (403), `unprocessable`
  (422), `ai_unavailable` (503). Founding Coach tier
  (`POST /coach/founding/claim|restore`): `not_founding_coach` (409),
  `club_covered` (409), `nothing_to_restore` (409), `stripe_error` (502).
- **Idempotency.** Creating POSTs may accept `Idempotency-Key` and set
  `idempotent: true`; replays are scoped by `(user_id, key)` for 24h.
- **Rate limiting.** Fixed-window, keyed by route + IP (+ user id when
  authenticated), via the `rateLimit` option.
- **OpenAPI.** `bun run openapi` regenerates `docs/api/openapi.json` from
  the registered zod schemas. CI fails if the committed file is stale. Every
  operation carries an `operationId` (derived from method and path unless
  the route sets one); client generators use it as the method name, so it
  is part of the v1 contract.
- **Design tokens.** `bun run design-tokens` regenerates
  `docs/api/design-tokens.json` from `src/styles.css` (OKLCH → sRGB with
  CSS Color 4 gamut mapping, light and dark; anything the converter does
  not understand is exported verbatim under `raw`, never dropped). CI fails
  a pull request if the committed file is stale and only warns on direct
  pushes to `main`, because Lovable commits stylesheet edits there directly.
  `gradus-ios` vendors this file with `openapi.json` and generates its
  color catalog from it (PRD §8.2, §9.1).

## Adding a route

1. Create the file under `src/routes/api/v1/<path>.ts`.
2. Define zod `input` (if any) and `output` schemas.
3. Call `defineApiRoute` and export it as `Route.server.handlers`:

```ts
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";

const outputSchema = z.object({ ok: z.literal(true) });

export const Route = createFileRoute("/api/v1/example")({
  server: {
    handlers: defineApiRoute({
      method: "GET",
      path: "/api/v1/example",
      auth: "public",
      output: outputSchema,
      handler: async () => ({ ok: true as const }),
    }),
  },
});
```

4. Add the module to `scripts/openapi.ts`'s import list.
5. Run `bun run openapi` and commit the regenerated `docs/api/openapi.json`.

## Trying it locally

```bash
API_V1_ENABLED=true bun run dev
curl http://localhost:3000/api/v1/meta/config
curl -H "Authorization: Bearer <token>" localhost:3000/api/v1/me/terms
```
