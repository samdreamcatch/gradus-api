import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createConnectStripeClient } from "@/lib/stripe-connect.server";
import { applySession } from "@/lib/coach-verification.server";

/**
 * Stripe Identity webhook (src/lib/coach-verification.server.ts). In the
 * Stripe Dashboard → Developers → Webhooks, add an endpoint here for
 * `identity.verification_session.verified`, `.requires_input`, `.processing`
 * and `.canceled`; its signing secret is STRIPE_IDENTITY_WEBHOOK_SECRET.
 * Each event records the session's outcome on its coach. Anything else is
 * acknowledged and ignored, so Stripe doesn't retry it.
 */
export const Route = createFileRoute("/api/public/webhooks/stripe-identity")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.STRIPE_IDENTITY_WEBHOOK_SECRET;
        if (!secret) {
          console.error("[stripe-identity] STRIPE_IDENTITY_WEBHOOK_SECRET is not configured");
          return new Response("Webhook not configured", { status: 500 });
        }
        const stripe = createConnectStripeClient();
        let event: { type: string; data: { object: unknown } };
        try {
          const body = await request.text();
          event = await stripe.webhooks.constructEventAsync(
            body,
            request.headers.get("stripe-signature") ?? "",
            secret,
          );
        } catch (e) {
          console.error("[stripe-identity] webhook verification failed", e);
          return new Response("Webhook error", { status: 400 });
        }
        try {
          if (event.type.startsWith("identity.verification_session.")) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await applySession(supabaseAdmin, event.data.object as any);
          }
          return Response.json({ received: true });
        } catch (e) {
          // A 500 makes Stripe retry later.
          console.error("[stripe-identity] webhook handling failed", e);
          return new Response("Webhook error", { status: 500 });
        }
      },
    },
  },
});
