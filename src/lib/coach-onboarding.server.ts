/**
 * Coach profile, sports/levels, and onboarding completion — the single
 * source of truth for the web server functions (coach-profile.functions.ts)
 * and the `/api/v1/coach/*` routes (PRD §6.2 pattern, Appendix A "Sign-up
 * and onboarding"). Extracted without behavior changes; user-facing
 * messages are kept verbatim and carried on ApiError so the API gets
 * stable codes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ApiContext } from "./api/auth";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import { isFoundingCoachWindowOpen } from "./paywall-flag";
import {
  athleteLimitForTier,
  type CoachEffectiveTier,
  type CoachLevelDTO,
  type CoachProfileDTO,
} from "./coach-profile-types";
import { getSport } from "./coach-sports";
import { effectiveCoachEntitlement } from "./club-access";

type Client = SupabaseClient<Database>;
type Admin = typeof supabaseAdmin;

export type CoachContext = {
  userId: string;
  /** Caller's RLS client: profile and level reads/writes go through it, as on the web. */
  supabase: Client;
  /** Service role, only for the billing columns the DB locks to trusted writers. */
  admin: Admin;
  /** `user_metadata` from the caller's token; seeds first/last name on first sight. */
  userMetadata?: Record<string, unknown> | null;
};

/** The API's request context, shaped for the coach functions. */
export function coachContext(ctx: ApiContext): CoachContext {
  return {
    userId: ctx.userId,
    supabase: ctx.supabase,
    admin: ctx.admin,
    userMetadata: ctx.claims?.userMetadata ?? null,
  };
}

const PROFILE_COLUMNS =
  "id, first_name, last_name, onboarded_at, entitlement, organization_id, subscription_tier, subscription_status, trial_ends_at, current_period_end, subscription_environment, stripe_customer_id, stripe_subscription_id, promo_code, founding_coach, founding_pro_trial_used, free_access_until";

/** Thrown (as `wrong_role`, 403) when a parent account hits a coach query; the web turns it into a redirect. */
export const WRONG_ROLE_CODE = "wrong_role";

export async function ensureCoachProfile(ctx: CoachContext) {
  const { supabase, admin, userId } = ctx;
  const existing = await supabase
    .from("coach_profiles")
    .select(PROFILE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing.error) dbError(existing.error);
  if (existing.data) {
    // Founding Coach backfill: while the founding window is open, any
    // onboarded coach that isn't actively on a paid sub or in a club gets
    // lazily stamped as founding + lifetime-free. This runs regardless of
    // any prior entitlement value so returning coaches also benefit.
    const activelyPaid = ["active", "trialing", "past_due"].includes(
      (existing.data.subscription_status as string | null) ?? "",
    );
    // Do NOT re-stamp promo_free if the coach already has a Stripe
    // subscription id — they're mid-checkout or in an incomplete state
    // and the sync path owns their entitlement.
    const hasStripeSub = Boolean(existing.data.stripe_subscription_id);
    const needsFoundingStamp =
      isFoundingCoachWindowOpen() &&
      existing.data.onboarded_at &&
      !existing.data.organization_id &&
      !activelyPaid &&
      !hasStripeSub &&
      (!existing.data.founding_coach || existing.data.entitlement === "pending");
    if (needsFoundingStamp) {
      // Billing columns are DB-locked to trusted writers; use the admin client.
      const upd = await admin
        .from("coach_profiles")
        .update({ entitlement: "promo_free", founding_coach: true })
        .eq("id", existing.data.id)
        .select(PROFILE_COLUMNS)
        .single();
      if (upd.error) dbError(upd.error);
      return upd.data;
    }

    return existing.data;
  }

  // Guard: don't silently turn a parent into a coach. A coach_profiles row
  // should only be created via the explicit coach signup flow.
  const parent = await supabase
    .from("parent_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (parent.error) dbError(parent.error);
  if (parent.data) {
    throw new ApiError({
      code: WRONG_ROLE_CODE,
      status: 403,
      message: "This account is a parent account.",
    });
  }

  // Seed first/last name from auth user_metadata (set during signup, or by
  // Google OAuth which only provides full_name). Avoids asking again in
  // onboarding.
  const m = (ctx.userMetadata ?? {}) as Record<string, unknown>;
  let firstName = typeof m.first_name === "string" ? m.first_name.trim() : "";
  let lastName = typeof m.last_name === "string" ? m.last_name.trim() : "";
  if (!firstName && !lastName && typeof m.full_name === "string") {
    const parts = m.full_name.trim().split(/\s+/);
    firstName = parts[0] ?? "";
    lastName = parts.slice(1).join(" ");
  }

  // founding_coach is a guarded billing column (trigger in
  // supabase/migrations/20260905200000_protect_billing_columns.sql), so the
  // insert goes through the admin client; user_id is still the caller's.
  const created = await admin
    .from("coach_profiles")
    .insert({
      user_id: userId,
      first_name: firstName,
      last_name: lastName,
      founding_coach: isFoundingCoachWindowOpen(),
    })
    .select(PROFILE_COLUMNS)
    .single();
  if (created.error) dbError(created.error);
  return created.data;
}

export type CoachProfileResponse = { profile: CoachProfileDTO; levels: CoachLevelDTO[] };

/** `getCoachProfile`. */
export async function getCoachProfile(ctx: CoachContext): Promise<CoachProfileResponse> {
  const { supabase, admin } = ctx;
  const profile = await ensureCoachProfile(ctx);

  const promoLookup = async () => {
    if (!profile.promo_code) return { data: null, error: null } as const;
    return admin
      .from("promo_codes")
      .select("label, percent_off, active")
      .eq("code", profile.promo_code)
      .maybeSingle();
  };

  const [levels, org, promo] = await Promise.all([
    supabase
      .from("coach_levels")
      .select("sport, level_key, practice_hours_per_week")
      .eq("coach_id", profile.id),
    profile.organization_id
      ? supabase
          .from("organizations")
          .select("name")
          .eq("id", profile.organization_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null } as const),
    promoLookup(),
  ]);
  if (levels.error) dbError(levels.error);
  if (org.error) dbError(org.error);
  if (promo.error) dbError(promo.error);

  const promoActive = promo.data?.active !== false;

  const countRes = await supabase
    .from("coach_athletes")
    .select("athlete_id", { count: "exact", head: true })
    .eq("coach_id", profile.id);
  if (countRes.error) dbError(countRes.error);
  const athleteCount = countRes.count ?? 0;

  // Time-boxed complimentary access (90 days after leaving a club). Once it
  // lapses the coach falls back to "pending" and the paywall takes over.
  const freeAccessUntil = (profile as { free_access_until?: string | null }).free_access_until
    ? ((profile as { free_access_until?: string | null }).free_access_until as string)
    : null;
  const rawEntitlement = (profile.entitlement ?? "pending") as CoachProfileDTO["entitlement"];
  const freeAccessExpired =
    rawEntitlement === "promo_free" &&
    Boolean(freeAccessUntil) &&
    new Date(freeAccessUntil as string) < new Date();
  const personalEntitlement: CoachProfileDTO["entitlement"] = freeAccessExpired
    ? "pending"
    : rawEntitlement;

  const organizationId = profile.organization_id ?? null;
  const subscriptionTier = (profile.subscription_tier as "coach" | "coach_pro" | null) ?? null;
  const tierResult = await admin.rpc("coach_effective_tier", { _coach_id: profile.id });
  if (tierResult.error) dbError(tierResult.error);
  const effectiveTier: CoachEffectiveTier = tierResult.data === "club" ? "club" : tierResult.data === "coach_pro" ? "coach_pro" : "coach";
  const effectiveEntitlement = effectiveCoachEntitlement({
    entitlement: personalEntitlement,
    tier: effectiveTier,
    foundingCoach: Boolean(profile.founding_coach),
    subscriptionStatus: profile.subscription_status ?? null,
  });
  const athleteLimit = athleteLimitForTier(effectiveTier);

  // Legacy card-free trials: only hit Stripe when the coach is actually
  // trialing, so the common case stays a pure DB read.
  let trialNeedsCard = false;
  if (profile.subscription_status === "trialing" && profile.stripe_customer_id) {
    try {
      const { createStripeClient } = await import("@/lib/stripe.server");
      const env = (profile.subscription_environment as "sandbox" | "live") ?? "sandbox";
      const stripe = createStripeClient(env);
      const methods = await stripe.paymentMethods.list({
        customer: profile.stripe_customer_id,
        limit: 1,
      });
      trialNeedsCard = methods.data.length === 0;
    } catch (err) {
      console.error("getCoachProfile: payment method check failed", err);
    }
  }

  const subscriptionEnvironment =
    (profile.subscription_environment as "sandbox" | "live" | null) ?? null;

  // Failed-payment banner: only for coaches who actually owe money, and
  // only when Stripe confirms the delinquency right now. A stale DB row,
  // a test-mode subscription, or a comped coach must never warn.
  const owesMoney =
    effectiveEntitlement !== "promo_free" && effectiveEntitlement !== "club_covered";
  let billingPastDue = false;
  if (
    owesMoney &&
    (profile.subscription_status === "past_due" || profile.subscription_status === "unpaid") &&
    profile.stripe_subscription_id &&
    subscriptionEnvironment
  ) {
    try {
      const { createStripeClient } = await import("@/lib/stripe.server");
      const stripe = createStripeClient(subscriptionEnvironment);
      const sub = await stripe.subscriptions.retrieve(profile.stripe_subscription_id);
      billingPastDue = sub.status === "past_due" || sub.status === "unpaid";
    } catch (err) {
      // Fail quiet — never warn about a payment we couldn't verify.
      console.error("getCoachProfile: past_due verification failed", err);
    }
  }

  return {
    profile: {
      id: profile.id,
      firstName: profile.first_name,
      lastName: profile.last_name,
      onboardedAt: profile.onboarded_at,
      entitlement: effectiveEntitlement,
      organizationId,
      organizationName: org.data?.name ?? null,
      subscriptionTier,
      subscriptionStatus: (profile.subscription_status as string | null) ?? null,
      trialEndsAt: (profile.trial_ends_at as string | null) ?? null,
      currentPeriodEnd: (profile.current_period_end as string | null) ?? null,
      hasStripeCustomer: Boolean(profile.stripe_customer_id),
      promoCode: profile.promo_code ?? null,
      promoLabel: promoActive ? (promo.data?.label ?? null) : null,
      promoPercentOff: promoActive ? (promo.data?.percent_off ?? 0) : 0,
      effectiveTier,
      athleteLimit,
      athleteCount,
      foundingCoach: Boolean(profile.founding_coach),
      foundingProTrialUsed: Boolean(profile.founding_pro_trial_used),
      freeAccessUntil,
      trialNeedsCard,
      subscriptionEnvironment,
      billingPastDue,
    },
    levels: (levels.data ?? []).map((r) => ({
      sport: r.sport,
      levelKey: r.level_key,
      hoursPerWeek: Number(r.practice_hours_per_week),
    })),
  };
}

export const coachNameSchema = z.object({
  firstName: z.string().trim().min(1, "Required").max(80),
  lastName: z.string().trim().min(1, "Required").max(80),
});

/** `saveCoachProfile`. */
export async function saveCoachProfile(
  ctx: CoachContext,
  data: z.infer<typeof coachNameSchema>,
): Promise<{ ok: true }> {
  const profile = await ensureCoachProfile(ctx);
  const { error } = await ctx.supabase
    .from("coach_profiles")
    .update({ first_name: data.firstName, last_name: data.lastName })
    .eq("id", profile.id);
  if (error) dbError(error);
  return { ok: true as const };
}

export const coachLevelsSchema = z.object({
  entries: z
    .array(
      z.object({
        sport: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z0-9_]+$/),
        levelKey: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z0-9_]+$/),
        hoursPerWeek: z.number().min(0).max(40),
      }),
    )
    .max(200),
});

/**
 * Sport keys in `requested` that are neither in the catalog nor already one
 * of the coach's own (`held`). Custom sports were replaced by "Request a
 * sport" (beta feedback 2026-10-07): existing ones keep working, but no
 * client, including a TestFlight build from before the change, may add one.
 */
export function newCustomSportKeys(requested: string[], held: Iterable<string>): string[] {
  const own = new Set(held);
  return [...new Set(requested.filter((key) => !getSport(key) && !own.has(key)))];
}

/** `saveCoachLevels`: replace strategy, then seed starter moves for new sports. */
export async function saveCoachLevels(
  ctx: CoachContext,
  data: z.infer<typeof coachLevelsSchema>,
): Promise<{ ok: true }> {
  const { supabase } = ctx;
  const profile = await ensureCoachProfile(ctx);

  const uncatalogued = data.entries.map((e) => e.sport).filter((key) => !getSport(key));
  if (uncatalogued.length > 0) {
    const held = await supabase.from("coach_levels").select("sport").eq("coach_id", profile.id);
    if (held.error) dbError(held.error);
    const fresh = newCustomSportKeys(
      uncatalogued,
      ((held.data ?? []) as Array<{ sport: string }>).map((r) => r.sport),
    );
    if (fresh.length > 0) {
      throw new ApiError({
        code: "validation_failed",
        status: 400,
        message: "Pick a listed sport. To add a new one, use Request a sport.",
        details: { sports: fresh },
      });
    }
  }

  // Replace strategy: delete all then insert. RLS scopes both to this coach.
  const del = await supabase.from("coach_levels").delete().eq("coach_id", profile.id);
  if (del.error) dbError(del.error);

  if (data.entries.length > 0) {
    const rows = data.entries.map((e) => ({
      coach_id: profile.id,
      sport: e.sport,
      level_key: e.levelKey,
      practice_hours_per_week: e.hoursPerWeek,
    }));
    const ins = await supabase.from("coach_levels").insert(rows);
    if (ins.error) dbError(ins.error);
  }

  // Keep the move library in sync with the coach's sports: seed starter
  // moves for any newly added sport (idempotent, never duplicates).
  const seedRes = await supabase.rpc("seed_coach_library", { _coach_id: profile.id });
  if (seedRes.error) {
    console.error("seed_coach_library failed after saveCoachLevels", {
      coachId: profile.id,
      message: seedRes.error.message,
    });
  }

  return { ok: true as const };
}

/** `completeOnboarding`: stamps onboarded_at (and Founding Coach while the window is open). */
export async function completeOnboarding(ctx: CoachContext): Promise<{ ok: true }> {
  const profile = await ensureCoachProfile(ctx);
  // Founding Coach grandfathering: while the founding window is open,
  // stamp coaches finishing onboarding as founding + complimentary.
  // Existing paid/club entitlement is preserved.
  const preserve = profile.entitlement === "paid" || profile.entitlement === "club_covered";
  const founding = isFoundingCoachWindowOpen() && !preserve;
  const patch = {
    onboarded_at: new Date().toISOString(),
    ...(founding ? { entitlement: "promo_free" as const, founding_coach: true } : {}),
  };
  // entitlement/founding_coach are DB-locked to trusted writers.
  const { error } = await ctx.admin.from("coach_profiles").update(patch).eq("id", profile.id);
  if (error) dbError(error);
  return { ok: true as const };
}
