// Kids Web Services `parent-verified` webhook (PRD §6.13 A2). Outside the
// /api/v1 kill switch on purpose: a provider callback must not depend on the
// iOS API flag. Auth is the HMAC in `x-kws-signature`; see handleKwsWebhook.

import { createFileRoute } from "@tanstack/react-router";
import { handleKwsWebhook } from "@/lib/guardian-verification.server";

export const Route = createFileRoute("/api/public/webhooks/kws")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          return await handleKwsWebhook(supabaseAdmin, request);
        } catch (err) {
          console.error("[api] kws webhook failed", err);
          return Response.json({ error: "internal" }, { status: 500 });
        }
      },
    },
  },
});
