import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { webSessionRoute } from "@/lib/api/web-session-route";

/**
 * `POST /api/v1/auth/web-session` — the options live in
 * `src/lib/api/web-session-route.ts` (covered by web-session-route.test.ts).
 * The app opens the returned `/auth/handoff#…` URL in Safari.
 */
export const Route = createFileRoute("/api/v1/auth/web-session")({
  server: {
    handlers: defineApiRoute(webSessionRoute()),
  },
});
