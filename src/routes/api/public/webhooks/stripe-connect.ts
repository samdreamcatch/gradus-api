import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  createConnectStripeClient,
  refreshConnectAccount,
  verifyConnectWebhook,
} from "@/lib/stripe-connect.server";

/**
 * Stripe Connect webhook (src/lib/stripe-connect.server.ts). Coaches'
 * accounts are Accounts v2, so Stripe sends "thin" event notifications: in
 * the Stripe Dashboard → Developers → Event destinations, add a destination
 * for v2 events about connected accounts pointing here, with at least
 * `v2.core.account[configuration.recipient].capability_status_updated` and
 * `v2.core.account[requirements].updated`; its signing secret is
 * STRIPE_CONNECT_WEBHOOK_SECRET. Each event about an account re-reads it
 * from Stripe and mirrors its status onto the coach. Anything else is
 * acknowledged and ignored, so Stripe doesn't retry it.
 */
export const Route = createFileRoute("/api/public/webhooks/stripe-connect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const stripe = createConnectStripeClient();
        let event: { type: string; accountId: string | null };
        try {
          event = await verifyConnectWebhook(request, stripe);
        } catch (e) {
          console.error("[stripe-connect] webhook verification failed", e);
          return new Response("Webhook error", { status: 400 });
        }
        try {
          if (event.accountId && event.type.startsWith("v2.core.account")) {
            const synced = await refreshConnectAccount(supabaseAdmin, stripe, event.accountId);
            if (!synced) console.warn("[stripe-connect] no coach for account", event.accountId);
          }
          return Response.json({ received: true });
        } catch (e) {
          // A 500 makes Stripe retry later.
          console.error("[stripe-connect] webhook handling failed", e);
          return new Response("Webhook error", { status: 500 });
        }
      },
    },
  },
});
