import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { recoverRoute } from "@/lib/api/auth-recover-route";

/**
 * `POST /api/v1/auth/recover` — the options live in
 * `src/lib/api/auth-recover-route.ts` so the redirect selection (`client`
 * omitted or `"web"` → the web reset page; `"app"` → `gradus://reset-password`)
 * is covered by auth-recover-route.test.ts with a fake GoTrue client. The
 * `client: "app"` value is inert until `gradus://reset-password` is on the
 * Supabase Auth redirect allow-list (docs/api/SMOKE.md).
 */
export const Route = createFileRoute("/api/v1/auth/recover")({
  server: {
    handlers: defineApiRoute(recoverRoute()),
  },
});
