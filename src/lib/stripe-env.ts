/**
 * Payments environment helper — deliberately free of any `@stripe/stripe-js`
 * import so screens that only need to know "sandbox vs live" (banners, admin
 * chips, settings rows) don't pull Stripe.js onto the page.
 */
export type StripeEnv = "sandbox" | "live";

const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;

export function getStripeClientToken(): string | undefined {
  return clientToken;
}

export function getStripeEnvironment(): StripeEnv {
  if (clientToken?.startsWith("pk_test_")) return "sandbox";
  if (clientToken?.startsWith("pk_live_")) return "live";
  throw new Error(
    "Stripe payments are not configured for this build. Complete Stripe go-live in your Lovable project to enable production checkout.",
  );
}
