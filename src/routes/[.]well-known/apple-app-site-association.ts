import { createFileRoute } from "@tanstack/react-router";
import { buildAppleAppSiteAssociation } from "@/lib/apple-app-site-association";

/**
 * `GET /.well-known/apple-app-site-association` (PRD §6.10): universal
 * links and password AutoFill for the iOS app. Served as JSON with no
 * extension and no redirect, as Apple's CDN requires; cacheable for a day.
 */
export const Route = createFileRoute("/.well-known/apple-app-site-association")({
  server: {
    handlers: {
      GET: async () =>
        new Response(JSON.stringify(buildAppleAppSiteAssociation(), null, 2) + "\n", {
          status: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": "public, max-age=86400",
          },
        }),
    },
  },
});
