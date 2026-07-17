import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  createStripeClient,
  getStripeErrorMessage,
  type StripeEnv,
} from "@/lib/stripe.server";
import { dbError } from "./db-error";

const codeSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().min(1).max(32));

async function assertAdmin(context: { userId: string; supabase: any }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
}

/** Validate a code (any signed-in user). Returns { valid, label, percentOff }. */
export const validatePromoCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ code: codeSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("promo_codes")
      .select("code, label, active, percent_off, duration, duration_in_months")
      .eq("code", data.code)
      .maybeSingle();
    if (error) dbError(error);
    if (!row || !row.active)
      return {
        valid: false as const,
        label: null,
        percentOff: 0,
        duration: "forever" as const,
        durationInMonths: null,
      };
    return {
      valid: true as const,
      label: row.label as string,
      percentOff: (row.percent_off as number | null) ?? 0,
      duration: ((row.duration as string | null) ?? "forever") as
        | "forever"
        | "repeating",
      durationInMonths: (row.duration_in_months as number | null) ?? null,
    };
  });

/**
 * Apply a promo code to the current user's profile rows (parent/coach/athlete).
 * Silently no-ops if the code is missing/inactive or the user has no matching
 * profile row yet. Safe to call after any signup flow completes.
 */
export const applyPromoCodeToMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ code: codeSchema.optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    if (!data.code) return { applied: false as const };

    const { data: row, error: lookupErr } = await context.supabase
      .from("promo_codes")
      .select("code, active")
      .eq("code", data.code)
      .maybeSingle();
    if (lookupErr) dbError(lookupErr);
    if (!row || !row.active) return { applied: false as const };

    const userId = context.userId;
    const [p, c, a] = await Promise.all([
      context.supabase
        .from("parent_profiles")
        .update({ promo_code: row.code })
        .eq("user_id", userId)
        .is("promo_code", null),
      context.supabase
        .from("coach_profiles")
        .update({ promo_code: row.code })
        .eq("user_id", userId)
        .is("promo_code", null),
      context.supabase
        .from("athletes")
        .update({ promo_code: row.code })
        .eq("user_id", userId)
        .is("promo_code", null),
    ]);
    // Ignore individual errors — user may only own one of these rows.
    const targets = [p, c, a].filter((r) => !r.error).length;
    return { applied: targets > 0 };
  });

/** Admin: list all promo codes. */
export const listPromoCodes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("promo_codes")
      .select(
        "code, label, active, notes, percent_off, stripe_promo_id_sandbox, stripe_promo_id_live, created_at",
      )
      .order("created_at", { ascending: false });
    if (error) dbError(error);
    return { codes: data ?? [] };
  });

/** Admin: create a new promo code. */
export const createPromoCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        code: codeSchema.pipe(
          z.string().regex(/^[A-Z0-9_-]+$/, "Letters, numbers, dash, underscore only"),
        ),
        label: z.string().trim().min(1).max(120),
        notes: z.string().trim().max(500).optional().nullable(),
        percentOff: z.number().int().min(0).max(100).default(0),
        active: z.boolean().optional().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("promo_codes").insert({
      code: data.code,
      label: data.label,
      notes: data.notes ?? null,
      percent_off: data.percentOff,
      active: data.active,
    });
    if (error) dbError(error);
    return { ok: true };
  });

/** Admin: update label/notes/active/percent_off on an existing promo code
 *  (code itself immutable). Changing percent_off invalidates any minted
 *  Stripe coupon — they get cleared here so the next sync re-mints. */
export const updatePromoCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        code: codeSchema,
        label: z.string().trim().min(1).max(120).optional(),
        notes: z.string().trim().max(500).nullable().optional(),
        percentOff: z.number().int().min(0).max(100).optional(),
        active: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: {
      label?: string;
      notes?: string | null;
      active?: boolean;
      percent_off?: number;
      stripe_coupon_id_sandbox?: string | null;
      stripe_promo_id_sandbox?: string | null;
      stripe_coupon_id_live?: string | null;
      stripe_promo_id_live?: string | null;
    } = {};
    if (data.label !== undefined) patch.label = data.label;
    if (data.notes !== undefined) patch.notes = data.notes;
    if (data.active !== undefined) patch.active = data.active;
    if (data.percentOff !== undefined) {
      patch.percent_off = data.percentOff;
      // percent_off change means any minted Stripe coupon is now stale.
      patch.stripe_coupon_id_sandbox = null;
      patch.stripe_promo_id_sandbox = null;
      patch.stripe_coupon_id_live = null;
      patch.stripe_promo_id_live = null;
    }
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabaseAdmin
      .from("promo_codes")
      .update(patch)
      .eq("code", data.code);

    if (error) dbError(error);
    return { ok: true };
  });

/**
 * Admin: idempotently mint (or re-mint) a Stripe Coupon + Promotion Code for
 * this promo in the requested environment, then record the IDs on the row.
 * Called from the admin UI after `createPromoCode` / `updatePromoCode`. Safe
 * to re-run — if IDs are already stored we skip.
 *
 * Coupon shape: `percent_off = row.percent_off`, `duration = "forever"`.
 * Promotion Code shape: the same `WILSON`-style code string, scoped to the
 * coupon above.
 */
export const syncPromoCodeToStripe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        code: codeSchema,
        environment: z.enum(["sandbox", "live"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const env: StripeEnv = data.environment;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error: readErr } = await supabaseAdmin
      .from("promo_codes")
      .select(
        "code, label, percent_off, duration, duration_in_months, stripe_coupon_id_sandbox, stripe_promo_id_sandbox, stripe_coupon_id_live, stripe_promo_id_live",
      )
      .eq("code", data.code)
      .maybeSingle();
    if (readErr) dbError(readErr);
    if (!row) throw new Error("Promo code not found.");
    if (!row.percent_off || row.percent_off <= 0) {
      throw new Error("Set a percent_off value before syncing to Stripe.");
    }

    const duration = ((row.duration as string | null) ?? "forever") as
      | "forever"
      | "repeating";
    const durationMonths = row.duration_in_months as number | null;
    if (duration === "repeating" && (!durationMonths || durationMonths <= 0)) {
      throw new Error("Repeating codes require duration_in_months > 0.");
    }

    const existingCoupon =
      env === "sandbox" ? row.stripe_coupon_id_sandbox : row.stripe_coupon_id_live;
    const existingPromo =
      env === "sandbox" ? row.stripe_promo_id_sandbox : row.stripe_promo_id_live;
    if (existingCoupon && existingPromo) {
      return {
        ok: true as const,
        alreadyMinted: true as const,
        couponId: existingCoupon,
        promoId: existingPromo,
      };
    }

    try {
      const stripe = createStripeClient(env);
      const durationLabel =
        duration === "repeating"
          ? `${row.percent_off}% off for ${durationMonths} month${durationMonths === 1 ? "" : "s"}`
          : `${row.percent_off}% off forever`;
      const coupon = await stripe.coupons.create({
        percent_off: row.percent_off,
        duration,
        ...(duration === "repeating" && { duration_in_months: durationMonths! }),
        name: `${row.label} — ${durationLabel}`,
        metadata: { gradus_code: row.code },
      });
      // 2. Promotion code (the human-readable label attached at checkout).
      //    Stripe requires promo `code` uniqueness per env; if a stale one
      //    from a previous mint still exists, reuse it instead of failing.
      let promoId: string;
      try {
        const promo = await stripe.promotionCodes.create({
          promotion: { type: "coupon", coupon: coupon.id },
          code: row.code,
          metadata: { gradus_code: row.code },
        });
        promoId = promo.id;
      } catch (err) {
        const msg = getStripeErrorMessage(err);
        // "code" conflict = already exists in this env; look it up.
        if (/already been used|already exists|code_already/i.test(msg)) {
          const list = await stripe.promotionCodes.list({
            code: row.code,
            limit: 1,
          });
          if (!list.data.length) throw err;
          promoId = list.data[0].id;
        } else {
          throw err;
        }
      }

      const patch: {
        stripe_coupon_id_sandbox?: string;
        stripe_promo_id_sandbox?: string;
        stripe_coupon_id_live?: string;
        stripe_promo_id_live?: string;
      } =
        env === "sandbox"
          ? { stripe_coupon_id_sandbox: coupon.id, stripe_promo_id_sandbox: promoId }
          : { stripe_coupon_id_live: coupon.id, stripe_promo_id_live: promoId };
      const { error: writeErr } = await supabaseAdmin
        .from("promo_codes")
        .update(patch)
        .eq("code", row.code);
      if (writeErr) dbError(writeErr);

      return {
        ok: true as const,
        alreadyMinted: false as const,
        couponId: coupon.id,
        promoId,
      };
    } catch (err) {
      return { ok: false as const, error: getStripeErrorMessage(err) };
    }
  });

/** Admin: signup counts per code across parents, coaches, athletes. */
export const getPromoCodeStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [parents, coaches, athletes] = await Promise.all([
      supabaseAdmin.from("parent_profiles").select("promo_code").not("promo_code", "is", null),
      supabaseAdmin.from("coach_profiles").select("promo_code").not("promo_code", "is", null),
      supabaseAdmin.from("athletes").select("promo_code").not("promo_code", "is", null),
    ]);
    if (parents.error) dbError(parents.error);
    if (coaches.error) dbError(coaches.error);
    if (athletes.error) dbError(athletes.error);

    const tally: Record<string, { parents: number; coaches: number; athletes: number }> = {};
    const bump = (code: string | null, key: "parents" | "coaches" | "athletes") => {
      if (!code) return;
      tally[code] ??= { parents: 0, coaches: 0, athletes: 0 };
      tally[code][key] += 1;
    };
    parents.data?.forEach((r) => bump(r.promo_code as string | null, "parents"));
    coaches.data?.forEach((r) => bump(r.promo_code as string | null, "coaches"));
    athletes.data?.forEach((r) => bump(r.promo_code as string | null, "athletes"));

    return { stats: tally };
  });
