import { createFileRoute } from "@tanstack/react-router";
import { defineApiRoute } from "@/lib/api/define-route";
import { coachSignupRoute } from "@/lib/api/coach-signup-route";

/**
 * Coach email/password sign-up. The coach profile row and the Terms
 * acceptance are recorded as soon as a session is minted; see
 * `src/lib/api/coach-signup-route.ts`.
 */
export const Route = createFileRoute("/api/v1/auth/signup/coach")({
  server: {
    handlers: defineApiRoute(coachSignupRoute()),
  },
});
