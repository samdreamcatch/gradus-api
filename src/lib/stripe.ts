// `@stripe/stripe-js/pure` does NOT inject https://js.stripe.com on import —
// the ~1MB script is fetched only when loadStripe() is actually called. The
// default entry point auto-injects it on every page that touches this module.
import { loadStripe } from "@stripe/stripe-js/pure";
import type { Stripe } from "@stripe/stripe-js";

import { getStripeClientToken, getStripeEnvironment, type StripeEnv } from "./stripe-env";

export type { StripeEnv };
export { getStripeEnvironment };

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    getStripeEnvironment();
    stripePromise = loadStripe(getStripeClientToken() as string);
  }
  return stripePromise;
}
