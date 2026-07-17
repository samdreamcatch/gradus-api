import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

import { dbError } from "./db-error";

export type CoachEntitlement =
  | "pending"
  | "club_covered"
  | "paid"
  | "promo_free";

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
  const selectCols =
    "id, first_name, last_name, onboarded_at, entitlement, organization_id, " +
    "subscription_tier, subscription_status, trial_ends_at, current_period_end, " +
    "stripe_customer_id, promo_code";
  const existing = await supabase
    .from("coach_profiles")
    .select(selectCols)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing.error) dbError(existing.error);
  if (existing.data) return existing.data;

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
    .insert({ user_id: userId, first_name: firstName, last_name: lastName })
    .select(selectCols)
    .single();
  if (created.error) dbError(created.error);
  return created.data;
}

export const getCoachProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as Client;
    const profile = await ensureProfile(supabase, context.userId, (context.claims as { user_metadata?: Record<string, unknown> }).user_metadata);

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
      profile.promo_code
        ? supabase
            .from("promo_codes")
            .select("label, percent_off, active")
            .eq("code", profile.promo_code)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null } as const),
    ]);
    if (levels.error) dbError(levels.error);
    if (org.error) dbError(org.error);
    if (promo.error) dbError(promo.error);

    const promoActive = promo.data?.active !== false;
    return {
      profile: {
        id: profile.id,
        firstName: profile.first_name,
        lastName: profile.last_name,
        onboardedAt: profile.onboarded_at,
        entitlement: (profile.entitlement ?? "pending") as CoachProfileDTO["entitlement"],
        organizationId: profile.organization_id ?? null,
        organizationName: org.data?.name ?? null,
        subscriptionTier:
          (profile.subscription_tier as "coach" | "coach_pro" | null) ?? null,
        subscriptionStatus:
          (profile.subscription_status as string | null) ?? null,
        trialEndsAt: (profile.trial_ends_at as string | null) ?? null,
        currentPeriodEnd: (profile.current_period_end as string | null) ?? null,
        hasStripeCustomer: Boolean(profile.stripe_customer_id),
        promoCode: profile.promo_code ?? null,
        promoLabel: promoActive ? (promo.data?.label ?? null) : null,
        promoPercentOff: promoActive ? (promo.data?.percent_off ?? 0) : 0,
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
    const profile = await ensureProfile(supabase, context.userId, (context.claims as { user_metadata?: Record<string, unknown> }).user_metadata);
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
    const profile = await ensureProfile(supabase, context.userId, (context.claims as { user_metadata?: Record<string, unknown> }).user_metadata);

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

    return { ok: true };
  });

export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as Client;
    const profile = await ensureProfile(supabase, context.userId, (context.claims as { user_metadata?: Record<string, unknown> }).user_metadata);
    const { error } = await supabase
      .from("coach_profiles")
      .update({ onboarded_at: new Date().toISOString() })
      .eq("id", profile.id);
    if (error) dbError(error);
    return { ok: true };
  });
