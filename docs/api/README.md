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
- **Idempotency.** Creating POSTs may accept `Idempotency-Key` and set
  `idempotent: true`; replays are scoped by `(user_id, key)` for 24h.
- **Rate limiting.** Fixed-window, keyed by route + IP (+ user id when
  authenticated), via the `rateLimit` option.
- **OpenAPI.** `bun run openapi` regenerates `docs/api/openapi.json` from
  the registered zod schemas. CI fails if the committed file is stale.

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
