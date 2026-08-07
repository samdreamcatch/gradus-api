import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createStripeClient, getStripeErrorMessage, type StripeEnv } from "@/lib/stripe.server";
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
  .inputValidator((input: unknown) => z.object({ code: codeSchema }).parse(input))
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
      duration: ((row.duration as string | null) ?? "forever") as "forever" | "repeating",
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
  .inputValidator((input: unknown) => z.object({ code: codeSchema.optional() }).parse(input ?? {}))
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
        "code, label, active, notes, percent_off, duration, duration_in_months, card_required, applies_to_plans, stripe_promo_id_sandbox, stripe_promo_id_live, created_at",
      )
      .order("created_at", { ascending: false });
    if (error) dbError(error);
    return { codes: data ?? [] };
  });

const planTierSchema = z.enum(["coach", "coach_pro"]);

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
        duration: z.enum(["forever", "repeating"]).optional().default("forever"),
        durationInMonths: z.number().int().min(1).max(60).nullable().optional(),
        cardRequired: z.boolean().optional().default(true),
        appliesToPlans: z.array(planTierSchema).min(1).optional().default(["coach", "coach_pro"]),
      })
      .refine((v) => v.duration === "forever" || (v.durationInMonths ?? 0) > 0, {
        message: "Repeating codes need a months value.",
        path: ["durationInMonths"],
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
      duration: data.duration,
      duration_in_months: data.duration === "repeating" ? (data.durationInMonths ?? null) : null,
      card_required: data.cardRequired,
      applies_to_plans: data.appliesToPlans,
    });
    if (error) dbError(error);
    return { ok: true };
  });

/** Admin: update editable fields on an existing promo code (code itself
 *  immutable). Changing percent_off/duration/months invalidates any minted
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
        duration: z.enum(["forever", "repeating"]).optional(),
        durationInMonths: z.number().int().min(1).max(60).nullable().optional(),
        cardRequired: z.boolean().optional(),
        appliesToPlans: z.array(planTierSchema).min(1).optional(),
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
      card_required?: boolean;
      applies_to_plans?: string[];
      percent_off?: number;
      duration?: string;
      duration_in_months?: number | null;
      stripe_coupon_id_sandbox?: string | null;
      stripe_promo_id_sandbox?: string | null;
      stripe_coupon_id_live?: string | null;
      stripe_promo_id_live?: string | null;
    } = {};
    if (data.label !== undefined) patch.label = data.label;
    if (data.notes !== undefined) patch.notes = data.notes;
    if (data.active !== undefined) patch.active = data.active;
    if (data.cardRequired !== undefined) patch.card_required = data.cardRequired;
    if (data.appliesToPlans !== undefined) patch.applies_to_plans = data.appliesToPlans;

    let couponInvalidated = false;
    if (data.percentOff !== undefined) {
      patch.percent_off = data.percentOff;
      couponInvalidated = true;
    }
    if (data.duration !== undefined) {
      patch.duration = data.duration;
      if (data.duration === "forever") patch.duration_in_months = null;
      couponInvalidated = true;
    }
    if (data.durationInMonths !== undefined) {
      patch.duration_in_months = data.durationInMonths;
      couponInvalidated = true;
    }
    if (couponInvalidated) {
      patch.stripe_coupon_id_sandbox = null;
      patch.stripe_promo_id_sandbox = null;
      patch.stripe_coupon_id_live = null;
      patch.stripe_promo_id_live = null;
    }
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabaseAdmin.from("promo_codes").update(patch).eq("code", data.code);

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

    const duration = ((row.duration as string | null) ?? "forever") as "forever" | "repeating";
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
        // Stripe coupon.name max length is 40 chars.
        name: `${row.label} — ${durationLabel}`.slice(0, 40),
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

export type PromoCodeUser = {
  userId: string;
  kind: "coach" | "parent" | "athlete";
  name: string;
  email: string | null;
  source: "stash" | "admin_next" | "admin_active";
  environment: "sandbox" | "live" | null;
};

/** List every user that has a promo code attached (stashed on profile or admin-applied). */
export const listPromoCodeUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ code: codeSchema }).parse(input))
  .handler(async ({ data, context }): Promise<{ users: PromoCodeUser[] }> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const code = data.code;

    const [coaches, parents, athletes, applied] = await Promise.all([
      supabaseAdmin
        .from("coach_profiles")
        .select("user_id, first_name, last_name")
        .eq("promo_code", code),
      supabaseAdmin
        .from("parent_profiles")
        .select("user_id, first_name, last_name")
        .eq("promo_code", code),
      supabaseAdmin
        .from("athletes")
        .select("user_id, first_name, last_name")
        .eq("promo_code", code)
        .not("user_id", "is", null),
      supabaseAdmin
        .from("user_applied_promo_codes")
        .select("user_id, scope, environment")
        .eq("code", code),
    ]);
    if (coaches.error) dbError(coaches.error);
    if (parents.error) dbError(parents.error);
    if (athletes.error) dbError(athletes.error);
    if (applied.error) dbError(applied.error);

    // Collect all user ids to look up emails from auth.
    const allIds = new Set<string>();
    coaches.data?.forEach((r) => r.user_id && allIds.add(r.user_id));
    parents.data?.forEach((r) => r.user_id && allIds.add(r.user_id));
    athletes.data?.forEach((r) => r.user_id && allIds.add(r.user_id));
    applied.data?.forEach((r) => r.user_id && allIds.add(r.user_id));

    // Emails via auth admin (paginate up to 1000 — matches admin users page).
    const emailByUser = new Map<string, string | null>();
    if (allIds.size > 0) {
      const list = await supabaseAdmin.auth.admin.listUsers({
        perPage: 1000,
        page: 1,
      });
      if (!list.error) {
        for (const u of list.data.users) {
          if (allIds.has(u.id)) emailByUser.set(u.id, u.email ?? null);
        }
      }
    }

    // Fetch names for admin-applied users whose profile has no stash.
    const knownProfiles = new Map<string, { kind: "coach" | "parent" | "athlete"; name: string }>();
    for (const c of coaches.data ?? []) {
      knownProfiles.set(c.user_id, {
        kind: "coach",
        name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "(coach)",
      });
    }
    for (const p of parents.data ?? []) {
      knownProfiles.set(p.user_id, {
        kind: "parent",
        name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "(parent)",
      });
    }
    for (const a of athletes.data ?? []) {
      if (a.user_id)
        knownProfiles.set(a.user_id, {
          kind: "athlete",
          name: `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() || "(athlete)",
        });
    }

    const missingIds = (applied.data ?? [])
      .map((r) => r.user_id)
      .filter((id): id is string => !!id && !knownProfiles.has(id));

    if (missingIds.length > 0) {
      const [mc, mp, ma] = await Promise.all([
        supabaseAdmin
          .from("coach_profiles")
          .select("user_id, first_name, last_name")
          .in("user_id", missingIds),
        supabaseAdmin
          .from("parent_profiles")
          .select("user_id, first_name, last_name")
          .in("user_id", missingIds),
        supabaseAdmin
          .from("athletes")
          .select("user_id, first_name, last_name")
          .in("user_id", missingIds)
          .not("user_id", "is", null),
      ]);
      for (const c of mc.data ?? []) {
        knownProfiles.set(c.user_id, {
          kind: "coach",
          name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "(coach)",
        });
      }
      for (const p of mp.data ?? []) {
        knownProfiles.set(p.user_id, {
          kind: "parent",
          name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "(parent)",
        });
      }
      for (const a of ma.data ?? []) {
        if (a.user_id)
          knownProfiles.set(a.user_id, {
            kind: "athlete",
            name: `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() || "(athlete)",
          });
      }
    }

    const seen = new Set<string>();
    const users: PromoCodeUser[] = [];

    // Stashed on profile.
    for (const [userId, prof] of knownProfiles) {
      // Only mark as "stash" if the profile actually has the code stashed.
      const stashed =
        (prof.kind === "coach" && coaches.data?.some((c) => c.user_id === userId)) ||
        (prof.kind === "parent" && parents.data?.some((p) => p.user_id === userId)) ||
        (prof.kind === "athlete" && athletes.data?.some((a) => a.user_id === userId));
      if (!stashed) continue;
      const key = `${userId}:stash`;
      if (seen.has(key)) continue;
      seen.add(key);
      users.push({
        userId,
        kind: prof.kind,
        name: prof.name,
        email: emailByUser.get(userId) ?? null,
        source: "stash",
        environment: null,
      });
    }

    // Admin-applied.
    for (const r of applied.data ?? []) {
      const prof = knownProfiles.get(r.user_id);
      const key = `${r.user_id}:${r.scope}:${r.environment ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      users.push({
        userId: r.user_id,
        kind: prof?.kind ?? "coach",
        name: prof?.name ?? "(unknown)",
        email: emailByUser.get(r.user_id) ?? null,
        source: r.scope === "active_now" ? "admin_active" : "admin_next",
        environment: (r.environment as "sandbox" | "live" | null) ?? null,
      });
    }

    users.sort((a, b) => a.name.localeCompare(b.name));
    return { users };
  });
