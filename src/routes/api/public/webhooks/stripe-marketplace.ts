import { createFileRoute } from "@tanstack/react-router";
import type Stripe from "stripe";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createConnectStripeClient } from "@/lib/stripe-connect.server";
import { fulfillPurchase, verifyMarketplaceWebhook } from "@/lib/plan-purchases.server";

/**
 * Marketplace Checkout webhook (src/lib/plan-purchases.server.ts). In the
 * Stripe Dashboard → Developers → Webhooks, add an endpoint for events on
 * your account pointing here, with `checkout.session.completed`,
 * `checkout.session.async_payment_succeeded` and `checkout.session.expired`;
 * its signing secret is STRIPE_MARKETPLACE_WEBHOOK_SECRET. A paid checkout is
 * delivered (coach's share transferred, plan copied); an expired one is marked
 * canceled. Anything else is acknowledged and ignored.
 */
export const Route = createFileRoute("/api/public/webhooks/stripe-marketplace")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const stripe = createConnectStripeClient();
        let event: Stripe.Event;
        try {
          event = await verifyMarketplaceWebhook(request, stripe);
        } catch (e) {
          console.error("[marketplace] webhook verification failed", e);
          return new Response("Webhook error", { status: 400 });
        }
        try {
          if (event.type.startsWith("checkout.session.")) {
            const session = event.data.object as Stripe.Checkout.Session;
            const purchaseId = session.metadata?.purchase_id ?? session.client_reference_id;
            if (purchaseId) await fulfillPurchase(supabaseAdmin, stripe, purchaseId);
          }
          return Response.json({ received: true });
        } catch (e) {
          // A 500 makes Stripe retry later.
          console.error("[marketplace] webhook handling failed", e);
          return new Response("Webhook error", { status: 500 });
        }
      },
    },
  },
});
