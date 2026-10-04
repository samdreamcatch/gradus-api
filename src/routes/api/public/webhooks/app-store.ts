// App Store Server Notifications V2 (PRD §6.13 B4, milestone S3). Outside the
// /api/v1 kill switch on purpose, like the KWS webhook: a provider callback
// must not depend on the iOS API flag. Auth is Apple's signature chain; see
// handleAppStoreNotification. Set this URL (production and sandbox) in App
// Store Connect → App Information → App Store Server Notifications, Version 2.

import { createFileRoute } from "@tanstack/react-router";
import { handleAppStoreNotification } from "@/lib/app-store-notifications.server";

export const Route = createFileRoute("/api/public/webhooks/app-store")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          return await handleAppStoreNotification(supabaseAdmin, request);
        } catch (err) {
          console.error("[api] app store webhook failed", err);
          return Response.json({ error: "internal" }, { status: 500 });
        }
      },
    },
  },
});
