import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

import { dbError } from "./db-error";
import { isFoundingCoachWindowOpen } from "./paywall-flag";

export type CoachEntitlement = "pending" | "club_covered" | "paid" | "promo_free";

export type CoachEffectiveTier = "coach" | "coach_pro" | "club";

export interface CoachProfileDTO {
  id: string;
  firstName: string;
  lastName: string;
  onboardedAt: string | null;
  entitlement: CoachEntitlement;
  organizationId: string | null;
  organizationName: string | null;
  subscriptionTier: "coach" | "coach_pro" | null;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  hasStripeCustomer: boolean;
  promoCode: string | null;
  promoLabel: string | null;
  promoPercentOff: number;
  effectiveTier: CoachEffectiveTier;
  /** null = unlimited (club). */
  athleteLimit: number | null;
  athleteCount: number;
  foundingCoach: boolean;
  foundingProTrialUsed: boolean;
  /**
   * When set, complimentary access ends on this date — currently only used
   * for the 90-day window after a coach leaves or is removed from a club.
   * Null means the free access has no end date (e.g. Founding Coach).
   */
  freeAccessUntil: string | null;
  /**
   * True when the coach is mid-trial on Stripe with no payment method on
   * file — legacy card-free trials started before cards became mandatory.
   * Drives the "add a card" nudge; never revokes access.
   */
  trialNeedsCard: boolean;
}

/** Mirrors public.coach_effective_tier() in the DB — DB is authoritative. */
export function computeEffectiveTier(input: {
  organizationId: string | null;
  subscriptionTier: "coach" | "coach_pro" | null;
}): CoachEffectiveTier {
  if (input.organizationId) return "club";
  if (input.subscriptionTier === "coach_pro") return "coach_pro";
  return "coach";
}

export function athleteLimitForTier(tier: CoachEffectiveTier): number | null {
  if (tier === "club") return null;
  if (tier === "coach_pro") return 50;
  return 5;
}

export interface CoachLevelDTO {
  sport: string;
  levelKey: string;
  hoursPerWeek: number;
}

type Client = SupabaseClient<Database>;

async function ensureProfile(
  supabase: Client,
  userId: string,
  meta?: Record<string, unknown> | null,
) {
  const existing = await supabase
    .from("coach_profiles")
    .select(
      "id, first_name, last_name, onboarded_at, entitlement, organization_id, subscription_tier, subscription_status, trial_ends_at, current_period_end, subscription_environment, stripe_customer_id, stripe_subscription_id, promo_code, founding_coach, founding_pro_trial_used, free_access_until",
    )
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
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const upd = await supabaseAdmin
        .from("coach_profiles")
        .update({
          entitlement: "promo_free",
          founding_coach: true,
        })
        .eq("id", existing.data.id)
        .select(
          "id, first_name, last_name, onboarded_at, entitlement, organization_id, subscription_tier, subscription_status, trial_ends_at, current_period_end, subscription_environment, stripe_customer_id, promo_code, founding_coach, founding_pro_trial_used, free_access_until",
        )
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
    throw new Error("This account is registered as a parent, not a coach.");
  }

  // Seed first/last name from auth user_metadata (set during signup, or by
  // Google OAuth which only provides full_name). Avoids asking again in
  // onboarding.
  const m = (meta ?? {}) as Record<string, unknown>;
  let firstName = typeof m.first_name === "string" ? m.first_name.trim() : "";
  let lastName = typeof m.last_name === "string" ? m.last_name.trim() : "";
  if (!firstName && !lastName && typeof m.full_name === "string") {
    const parts = m.full_name.trim().split(/\s+/);
    firstName = parts[0] ?? "";
    lastName = parts.slice(1).join(" ");
  }

  const created = await supabase
    .from("coach_profiles")
    .insert({
      user_id: userId,
      first_name: firstName,
      last_name: lastName,
      founding_coach: isFoundingCoachWindowOpen(),
    })
    .select(
      "id, first_name, last_name, onboarded_at, entitlement, organization_id, subscription_tier, subscription_status, trial_ends_at, current_period_end, subscription_environment, stripe_customer_id, promo_code, founding_coach, founding_pro_trial_used, free_access_until",
    )
    .single();
  if (created.error) dbError(created.error);
  return created.data;
}

export const getCoachProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as Client;
    const profile = await ensureProfile(
      supabase,
      context.userId,
      (context.claims as { user_metadata?: Record<string, unknown> }).user_metadata,
    );

    const promoLookup = async () => {
      if (!profile.promo_code) return { data: null, error: null } as const;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      return supabaseAdmin
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

    const organizationId = profile.organization_id ?? null;
    const subscriptionTier = (profile.subscription_tier as "coach" | "coach_pro" | null) ?? null;
    const effectiveTier = computeEffectiveTier({ organizationId, subscriptionTier });
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
      } as CoachProfileDTO,
      levels: (levels.data ?? []).map((r) => ({
        sport: r.sport,
        levelKey: r.level_key,
        hoursPerWeek: Number(r.practice_hours_per_week),
      })) as CoachLevelDTO[],
    };
  });

const nameSchema = z.object({
  firstName: z.string().trim().min(1, "Required").max(80),
  lastName: z.string().trim().min(1, "Required").max(80),
});

export const saveCoachProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => nameSchema.parse(input))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Client;
    const profile = await ensureProfile(
      supabase,
      context.userId,
      (context.claims as { user_metadata?: Record<string, unknown> }).user_metadata,
    );
    const { error } = await supabase
      .from("coach_profiles")
      .update({ first_name: data.firstName, last_name: data.lastName })
      .eq("id", profile.id);
    if (error) dbError(error);
    return { ok: true };
  });

const levelsSchema = z.object({
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

export const saveCoachLevels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => levelsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Client;
    const profile = await ensureProfile(
      supabase,
      context.userId,
      (context.claims as { user_metadata?: Record<string, unknown> }).user_metadata,
    );

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

    return { ok: true };
  });

export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as Client;
    const profile = await ensureProfile(
      supabase,
      context.userId,
      (context.claims as { user_metadata?: Record<string, unknown> }).user_metadata,
    );
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("coach_profiles")
      .update(patch)
      .eq("id", profile.id);
    if (error) dbError(error);
    return { ok: true };
  });
