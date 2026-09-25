/**
 * The `apple-app-site-association` document for gradus.training (PRD §6.10,
 * §6.4 password AutoFill, Appendix D). Served by
 * `src/routes/[.]well-known/apple-app-site-association.ts`.
 *
 * Apple's CDN fetches this once and caches it, so it is published only with
 * the real Team ID (Mariah, 2026-09-24) and never with a placeholder.
 *
 * Path rules: Apple evaluates `components` in order and the first match
 * wins, so every excluded path comes before the wildcard app paths. Excluded
 * paths stay in Safari (legal pages, admin, API, email previews, and the
 * password reset until the recovery token can reach the app).
 */
export const APPLE_TEAM_ID = "79RN82HXPZ";
export const IOS_BUNDLE_ID = "training.gradus.app";
export const IOS_APP_ID = `${APPLE_TEAM_ID}.${IOS_BUNDLE_ID}`;

/** Paths that must open in Safari even with the app installed (PRD §6.10). */
export const UNIVERSAL_LINK_EXCLUDES = [
  "/reset-password",
  "/reset-password/*",
  "/privacy",
  "/terms",
  "/unsubscribe",
  "/unsubscribe/*",
  "/admin",
  "/admin/*",
  "/org-admin",
  "/org-admin/*",
  "/api/*",
  "/email/*",
  "/lovable/*",
] as const;

/** Paths the app handles (PRD §6.10, in the table's order). */
export const UNIVERSAL_LINK_PATHS = [
  "/board",
  "/board/*",
  "/i/*",
  "/login",
  "/signup/*",
  "/coach",
  "/coach/*",
  "/parent",
  "/parent/*",
  "/athlete",
  "/athlete/*",
  "/g/*",
  "/team/*",
  "/p/*",
] as const;

export type AppleAppSiteAssociation = {
  applinks: {
    details: {
      appIDs: string[];
      components: { "/": string; exclude?: true; comment?: string }[];
    }[];
  };
  webcredentials: { apps: string[] };
};

export function buildAppleAppSiteAssociation(): AppleAppSiteAssociation {
  return {
    applinks: {
      details: [
        {
          appIDs: [IOS_APP_ID],
          components: [
            ...UNIVERSAL_LINK_EXCLUDES.map((path) => ({
              "/": path,
              exclude: true as const,
              comment: "Stays in Safari (PRD §6.10)",
            })),
            ...UNIVERSAL_LINK_PATHS.map((path) => ({ "/": path })),
          ],
        },
      ],
    },
    webcredentials: { apps: [IOS_APP_ID] },
  };
}
