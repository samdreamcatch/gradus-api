import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  type StripeEnv,
  createStripeClient,
  getStripeErrorMessage,
} from "@/lib/stripe.server";

const inputSchema = z.object({
  priceId: z.enum([
    "coach_monthly",
    "coach_yearly",
    "coach_pro_monthly",
    "coach_pro_yearly",
  ]),
  environment: z.enum(["sandbox", "live"]),
  returnUrl: z.string().url(),
});

type CheckoutSessionResult = { clientSecret: string } | { error: string };

export const startCoachCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }): Promise<CheckoutSessionResult> => {
    try {
      const env = data.environment as StripeEnv;
      const stripe = createStripeClient(env);
      const { userId, supabase } = context;

      // Look up email + existing customer id from coach profile.
      const { data: profile } = await supabase
        .from("coach_profiles")
        .select("id, stripe_customer_id")
        .eq("user_id", userId)
        .maybeSingle();

      const {
        data: { user },
      } = await supabase.auth.getUser();
      const email = user?.email ?? undefined;

      // Resolve or create a Stripe customer scoped by userId metadata.
      let customerId = profile?.stripe_customer_id ?? undefined;
      if (!customerId) {
        const found = await stripe.customers.search({
          query: `metadata['userId']:'${userId}'`,
          limit: 1,
        });
        if (found.data.length) {
          customerId = found.data[0].id;
        } else {
          const created = await stripe.customers.create({
            ...(email && { email }),
            metadata: { userId },
          });
          customerId = created.id;
        }
      }

      // Resolve human-readable price id to the Stripe price.
      const prices = await stripe.prices.list({ lookup_keys: [data.priceId] });
      if (!prices.data.length) throw new Error("Price not found");
      const stripePrice = prices.data[0];

      const session = await stripe.checkout.sessions.create({
        line_items: [{ price: stripePrice.id, quantity: 1 }],
        mode: "subscription",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        customer: customerId,
        subscription_data: {
          trial_period_days: 90,
          metadata: { userId },
        },
        metadata: { userId },
      });

      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });
