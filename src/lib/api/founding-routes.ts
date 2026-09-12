/**
 * Route options for `POST /api/v1/coach/founding/claim` and
 * `POST /api/v1/coach/founding/restore` (PRD §3.6/§3.7, §6.8, Appendix A
 * "Billing"), kept out of the file routes so the pipeline — no body, the
 * server-derived Stripe environment, the API-only guards — can be exercised
 * with `createApiRouteHandler`, a fake admin and a stubbed Stripe client
 * (founding-routes.test.ts). The file routes spread
 * `defineApiRoute(claimFoundingCoachTierRoute())` etc.
 */
import { requireContext } from "./auth";
import type { DefineApiRouteOptions } from "./define-route";
import { okSchema } from "./onboarding-schema";
import {
  claimFoundingCoachTier,
  defaultFoundingTierDeps,
  restoreFoundingCoachTier,
  type FoundingTierDeps,
  type FoundingTierResultDTO,
} from "@/lib/founding-tier.server";

/**
 * Claim the free Founding Coach tier. No body; `{ ok: true }` whether the
 * entitlement was just granted or was already in place — the client
 * re-fetches `GET /coach/billing` afterwards. Judged on the effective
 * entitlement `GET /coach/billing` reports: a founding coach whose 90-day
 * club-exit grace lapsed (reads `pending`) is re-granted with the grace date
 * cleared, so the claim action goes away after one call. 403 `wrong_role`
 * without a coach row (never creates one), 409 `not_founding_coach`
 * otherwise. `[idem]`: naturally idempotent, and honors `Idempotency-Key`.
 */
export function claimFoundingCoachTierRoute(): DefineApiRouteOptions<
  undefined,
  FoundingTierResultDTO
> {
  return {
    method: "POST",
    path: "/api/v1/coach/founding/claim",
    operationId: "claimFoundingCoachTier",
    auth: "user",
    summary: "Claim the free Founding Coach tier",
    output: okSchema,
    idempotent: true,
    rateLimit: { windowSeconds: 3600, max: 20 },
    handler: async ({ ctx }) => {
      const { userId, supabase, admin } = requireContext(ctx);
      return claimFoundingCoachTier({ userId, supabase, admin }, { apiContract: true });
    },
  };
}

/**
 * Restore the free Founding Coach tier from a paid Coach Pro plan: cancels
 * every active/trialing/past-due Stripe subscription on the coach's customer
 * immediately (no proration, no refund; the one-time founding Pro trial is
 * not restored), then rewrites the billing columns. No body — the Stripe
 * environment is the profile's own, else the server's; a caller can never
 * aim the cancel at the other Stripe account. 409 `club_covered` while
 * club-linked (`DELETE /coach/org` first), 409 `nothing_to_restore` unless on
 * a paid plan, 502 `stripe_error` before any database write. Online-only on
 * the client, behind a confirmation.
 */
export function restoreFoundingCoachTierRoute(
  deps: FoundingTierDeps = defaultFoundingTierDeps,
): DefineApiRouteOptions<undefined, FoundingTierResultDTO> {
  return {
    method: "POST",
    path: "/api/v1/coach/founding/restore",
    operationId: "restoreFoundingCoachTier",
    auth: "user",
    summary: "Switch back to the free Founding Coach tier, canceling any paid subscription",
    output: okSchema,
    idempotent: true,
    rateLimit: { windowSeconds: 3600, max: 5 },
    handler: async ({ ctx }) => {
      const { userId, supabase, admin } = requireContext(ctx);
      return restoreFoundingCoachTier({ userId, supabase, admin }, {}, { apiContract: true }, deps);
    },
  };
}
