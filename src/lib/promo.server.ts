/**
 * Promo codes as a member sees them: validate one, apply one to the caller's
 * own profile. Single source of truth for the web server functions
 * (promo-codes.functions.ts) and `/api/v1/promo-codes/validate` and
 * `/api/v1/me/promo-code` (PRD §6.2 pattern, Appendix A). Extracted without
 * behavior changes. Admin promo management stays in the web functions file.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;
type Admin = typeof supabaseAdmin;

export const promoCodeSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().min(1).max(32));

export type PromoValidation =
  | { valid: false; label: null; percentOff: 0; duration: "forever"; durationInMonths: null }
  | {
      valid: true;
      label: string;
      percentOff: number;
      duration: "forever" | "repeating";
      durationInMonths: number | null;
    };

/** `validatePromoCode`: what a code is worth, or an inert shape when unknown/inactive. */
export async function validatePromoCode(
  ctx: { supabase: Client },
  code: string,
): Promise<PromoValidation> {
  const { data: row, error } = await ctx.supabase
    .from("promo_codes")
    .select("code, label, active, percent_off, duration, duration_in_months")
    .eq("code", code)
    .maybeSingle();
  if (error) dbError(error);
  if (!row || !row.active) {
    return {
      valid: false,
      label: null,
      percentOff: 0,
      duration: "forever",
      durationInMonths: null,
    };
  }
  return {
    valid: true,
    label: row.label as string,
    percentOff: (row.percent_off as number | null) ?? 0,
    duration: ((row.duration as string | null) ?? "forever") as "forever" | "repeating",
    durationInMonths: (row.duration_in_months as number | null) ?? null,
  };
}

/**
 * `applyPromoCodeToMyProfile`: stamps an active code on whichever profile
 * row the caller owns, only where none is set yet (first code wins).
 */
export async function applyPromoCodeToMyProfile(
  ctx: { userId: string; supabase: Client; admin: Admin },
  code: string | undefined,
): Promise<{ applied: boolean }> {
  if (!code) return { applied: false };

  const { data: row, error: lookupErr } = await ctx.supabase
    .from("promo_codes")
    .select("code, active")
    .eq("code", code)
    .maybeSingle();
  if (lookupErr) dbError(lookupErr);
  if (!row || !row.active) return { applied: false };

  const { userId, admin, supabase } = ctx;
  // promo_code is DB-locked to trusted writers on profile tables.
  const [p, c, a] = await Promise.all([
    admin
      .from("parent_profiles")
      .update({ promo_code: row.code })
      .eq("user_id", userId)
      .is("promo_code", null),
    admin
      .from("coach_profiles")
      .update({ promo_code: row.code })
      .eq("user_id", userId)
      .is("promo_code", null),
    supabase
      .from("athletes")
      .update({ promo_code: row.code })
      .eq("user_id", userId)
      .is("promo_code", null),
  ]);
  // Ignore individual errors — user may only own one of these rows.
  const targets = [p, c, a].filter((r) => !r.error).length;
  return { applied: targets > 0 };
}
