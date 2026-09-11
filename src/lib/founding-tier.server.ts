/**
 * Founding Coach tier — claim the free Coach tier, and restore it from a
 * paid Coach Pro subscription (PRD §3.6/§3.7, §6.8, Appendix A "Billing").
 *
 * Single source of truth for the `claimFoundingCoachTier` /
 * `restoreFoundingCoachTier` server functions in
 * `coach-checkout.functions.ts` and the `/api/v1/coach/founding/…` routes.
 * Extracted without behavior changes except the ones called out inline,
 * which are API-only behind `opts.apiContract` (E1: claim also clears
 * `free_access_until`; restore refuses with `nothing_to_restore` unless the
 * coach is actually on a paid plan). The web wrappers turn `ApiError`s back
 * into their original `{ error: message }` results.
 *
 * Billing columns on `coach_profiles` are guarded by a trigger that only the
 * service role may pass (supabase/migrations/20260905200000_protect_billing_columns.sql),
 * so the caller's own row is READ through the RLS client and every WRITE
 * goes through the admin client, targeting `.eq("id", profile.id)`
 * explicitly because RLS no longer applies there.
 *
 * Neither function writes a `billing_events` audit row or sends email
 * (parity with the web). After a restore, Stripe's `customer.subscription.*`
 * webhooks may re-write `subscription_tier`/`subscription_status` from the
 * canceled subscription (coach-subscription-sync.server.ts); `entitlement`
 * stays `promo_free`. Pre-existing on the web; documented, not fixed here.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import { getStripeEnvironment } from "./stripe-env";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "./stripe.server";

export type FoundingTierContext = {
  userId: string;
  /** Caller's RLS client: reads the coach's own `coach_profiles` row. */
  supabase: SupabaseClient<Database>;
  /** Service role, only for the billing columns the DB locks to trusted writers. */
  admin: typeof supabaseAdmin;
};

/**
 * API-only strictness (PRD §6.2 stable codes). The web wrappers leave this
 * off and keep their original behavior, per PRD §4.1 rule 1.
 */
export type FoundingTierOptions = {
  /**
   * `claimFoundingCoachTier` (E1): when granting `promo_free`, also clear
   * `free_access_until`, so a founding coach whose 90-day club-exit grace
   * lapsed (club-exit.server.ts) no longer reads as `pending` forever.
   * `restoreFoundingCoachTier`: refuse (409 `nothing_to_restore`) unless the
   * coach's entitlement is `paid`, instead of the web's unconditional write of
   * `subscription_status: "canceled"` on an already-free coach.
   */
  apiContract?: boolean;
};

/** The slice of the Stripe SDK restore uses; a stub in tests. */
export interface FoundingStripeClient {
  subscriptions: {
    list(params: {
      customer: string;
      status: "all";
      limit: number;
    }): Promise<{ data: Array<{ id: string; status: string }> }>;
    cancel(id: string): Promise<unknown>;
  };
}

export type FoundingTierDeps = {
  createStripe: (env: StripeEnv) => FoundingStripeClient;
  /**
   * The Stripe environment when the profile carries none and the caller
   * supplied none: the build's own (`VITE_PAYMENTS_CLIENT_TOKEN` prefix),
   * else `live`. Evaluated on the server; never a client-supplied value.
   */
  defaultEnvironment: () => StripeEnv;
};

export function defaultStripeEnvironment(): StripeEnv {
  try {
    return getStripeEnvironment();
  } catch {
    return "live";
  }
}

export const defaultFoundingTierDeps: FoundingTierDeps = {
  createStripe: (env) => createStripeClient(env),
  defaultEnvironment: defaultStripeEnvironment,
};

const wrongRole = (message: string) => new ApiError({ code: "wrong_role", status: 403, message });
const notFoundingCoach = (message: string) =>
  new ApiError({ code: "not_founding_coach", status: 409, message });
const clubCovered = (message: string) =>
  new ApiError({ code: "club_covered", status: 409, message });
const nothingToRestore = (message: string) =>
  new ApiError({ code: "nothing_to_restore", status: 409, message });
const stripeError = (message: string) =>
  new ApiError({ code: "stripe_error", status: 502, message });

const COACH_PROFILE_NOT_FOUND = "Coach profile not found.";
const NOT_FOUNDING_COACH = "This account isn't a founding coach.";
const CLUB_COVERED = "You're on a club plan. Leave the club before switching tiers.";
const NOTHING_TO_RESTORE = "Nothing to switch — you're already on the free Founding Coach plan.";

/** Subscriptions restore cancels immediately (no proration, no refund). */
const CANCELABLE_STATUSES = ["active", "trialing", "past_due"];

export interface FoundingTierResultDTO {
  ok: true;
}

/**
 * The web's `restoreFoundingCoachTier` input: the client-detected Stripe
 * environment, used only when the profile carries none. The API route has no
 * input — it derives the environment server-side (`defaultEnvironment`).
 */
export const restoreFoundingCoachTierInput = z.object({
  environment: z.enum(["sandbox", "live"]),
});
export type RestoreFoundingCoachTierInput = z.infer<typeof restoreFoundingCoachTierInput>;

/**
 * Founding-coach free-Coach-tier claim. Grants entitlement without touching
 * Stripe so a brand-new coach can proceed through onboarding without a
 * checkout session. Idempotent — safe to call repeatedly.
 *
 * Decision table (unchanged): not a founding coach → 409 `not_founding_coach`;
 * club-linked, or already `promo_free`/`paid`/`club_covered` → `{ ok }`
 * without a write; otherwise `entitlement: "promo_free"`. A caller with no
 * coach row answers 403 `wrong_role`; nothing here ever creates one.
 */
export async function claimFoundingCoachTier(
  ctx: FoundingTierContext,
  opts: FoundingTierOptions = {},
): Promise<FoundingTierResultDTO> {
  const { data: profile, error: readErr } = await ctx.supabase
    .from("coach_profiles")
    .select("id, founding_coach, entitlement, organization_id")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (readErr) dbError(readErr);
  if (!profile) throw wrongRole(COACH_PROFILE_NOT_FOUND);
  if (!profile.founding_coach) throw notFoundingCoach(NOT_FOUNDING_COACH);
  if (profile.organization_id) {
    // Already covered by a club — no change needed.
    return { ok: true };
  }
  if (
    profile.entitlement === "promo_free" ||
    profile.entitlement === "paid" ||
    profile.entitlement === "club_covered"
  ) {
    return { ok: true };
  }
  const { error } = await ctx.admin
    .from("coach_profiles")
    .update(
      opts.apiContract
        ? // E1 (API only): the free Founding Coach tier has no end date; a
          // stale club-exit grace date would otherwise keep `getCoachProfile`
          // reporting `pending` after this claim succeeded.
          { entitlement: "promo_free", free_access_until: null }
        : { entitlement: "promo_free" },
    )
    .eq("id", profile.id);
  if (error) dbError(error);
  return { ok: true };
}

/**
 * Founding-coach downgrade: cancel any active Coach Pro subscription and
 * restore the free founding Coach tier without proration/refund logic
 * running through `changeCoachSubscription` (which would try to swap to a
 * paid Coach price). Safe if no active sub exists.
 *
 * Order: coach row (403 `wrong_role`) → founding (409 `not_founding_coach`)
 * → club-linked (409 `club_covered`; leave the club first) → [API only]
 * on a paid plan (409 `nothing_to_restore`) → Stripe cancels (a list failure
 * is 502 `stripe_error` and happens BEFORE any database write) → the admin
 * update. `founding_pro_trial_used` and `stripe_customer_id` are untouched.
 */
export async function restoreFoundingCoachTier(
  ctx: FoundingTierContext,
  input: Partial<RestoreFoundingCoachTierInput> = {},
  opts: FoundingTierOptions = {},
  deps: FoundingTierDeps = defaultFoundingTierDeps,
): Promise<FoundingTierResultDTO> {
  const { data: profile, error: readErr } = await ctx.supabase
    .from("coach_profiles")
    .select(
      "id, founding_coach, entitlement, organization_id, stripe_customer_id, stripe_subscription_id, subscription_environment",
    )
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (readErr) dbError(readErr);
  if (!profile) throw wrongRole(COACH_PROFILE_NOT_FOUND);
  if (!profile.founding_coach) throw notFoundingCoach(NOT_FOUNDING_COACH);
  if (profile.organization_id) throw clubCovered(CLUB_COVERED);
  if (opts.apiContract && profile.entitlement !== "paid") {
    throw nothingToRestore(NOTHING_TO_RESTORE);
  }

  // The profile's own environment wins; the web's client-detected value is
  // the explicit fallback, and the API (no input) uses the server's own.
  const stored = profile.subscription_environment as StripeEnv | null;
  const env: StripeEnv =
    stored === "live" || stored === "sandbox"
      ? stored
      : (input.environment ?? deps.defaultEnvironment());

  // Cancel any active-ish subscription on this customer immediately.
  if (profile.stripe_customer_id) {
    try {
      const stripe = deps.createStripe(env);
      const list = await stripe.subscriptions.list({
        customer: profile.stripe_customer_id,
        status: "all",
        limit: 20,
      });
      for (const sub of list.data) {
        if (CANCELABLE_STATUSES.includes(sub.status)) {
          try {
            await stripe.subscriptions.cancel(sub.id);
          } catch (e) {
            console.warn("restoreFoundingCoachTier: cancel failed", sub.id, e);
          }
        }
      }
    } catch (error) {
      throw stripeError(getStripeErrorMessage(error));
    }
  }

  const { error } = await ctx.admin
    .from("coach_profiles")
    .update({
      entitlement: "promo_free",
      subscription_tier: null,
      subscription_status: "canceled",
      stripe_subscription_id: null,
      trial_ends_at: null,
      current_period_end: null,
    })
    .eq("id", profile.id);
  if (error) dbError(error);
  return { ok: true };
}
