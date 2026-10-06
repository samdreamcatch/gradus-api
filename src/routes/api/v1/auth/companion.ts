import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { companionSessionRoute } from "@/lib/api/companion-session-route";

/**
 * `POST /api/v1/auth/companion` — the options live in
 * `src/lib/api/companion-session-route.ts` (covered by companion-session-route.test.ts).
 */
export const Route = createFileRoute("/api/v1/auth/companion")({
  server: {
    handlers: defineApiRoute(companionSessionRoute()),
  },
});
