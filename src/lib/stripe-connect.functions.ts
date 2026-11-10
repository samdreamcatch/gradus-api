/**
 * Web server functions for Stripe Connect (coach settings → Payouts). Thin
 * wrappers over src/lib/stripe-connect.server.ts, the same implementation as
 * `/api/v1/coach/stripe-connect*`.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getStripeErrorMessage } from "@/lib/stripe.server";
import {
  createStripeConnectDashboardLink,
  getStripeConnectStatus,
  startStripeConnectOnboarding,
  stripeConnectOnboardingInput,
  type StripeConnectStatusDTO,
} from "@/lib/stripe-connect.server";

type LinkResult = { url: string } | { error: string };

export const getStripeConnectStatusFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ refresh: z.boolean().default(false) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<StripeConnectStatusDTO> => {
    return getStripeConnectStatus(
      { userId: context.userId, admin: supabaseAdmin },
      { refresh: data.refresh },
    );
  });

export const startStripeConnectOnboardingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => stripeConnectOnboardingInput.parse(input))
  .handler(async ({ data, context }): Promise<LinkResult> => {
    try {
      return await startStripeConnectOnboarding(
        { userId: context.userId, admin: supabaseAdmin },
        data,
      );
    } catch (error) {
      console.error("[stripe-connect] onboarding failed", error);
      return { error: getStripeErrorMessage(error) };
    }
  });

export const openStripeConnectDashboardFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LinkResult> => {
    try {
      return await createStripeConnectDashboardLink({
        userId: context.userId,
        admin: supabaseAdmin,
      });
    } catch (error) {
      console.error("[stripe-connect] dashboard link failed", error);
      return { error: error instanceof Error ? error.message : getStripeErrorMessage(error) };
    }
  });
