/**
 * Pages the iOS app may open signed in through `/auth/handoff` (see
 * `src/lib/api/web-session-route.ts`). Shared by the API route and the page,
 * so a fragment can never send the browser anywhere else.
 */
export const WEB_HANDOFF_PATHS = [
  "/coach/paywall",
  "/coach/settings",
  "/parent/team",
  "/parent/settings",
] as const;

export type WebHandoffPath = (typeof WEB_HANDOFF_PATHS)[number];

export function isWebHandoffPath(value: string | null | undefined): value is WebHandoffPath {
  return !!value && (WEB_HANDOFF_PATHS as readonly string[]).includes(value);
}
