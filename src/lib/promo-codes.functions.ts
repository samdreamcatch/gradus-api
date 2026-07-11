import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
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

/** Validate a code (any signed-in user). Returns { valid, label }. */
export const validatePromoCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ code: codeSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("promo_codes")
      .select("code, label, active")
      .eq("code", data.code)
      .maybeSingle();
    if (error) dbError(error);
    if (!row || !row.active) return { valid: false as const, label: null };
    return { valid: true as const, label: row.label as string };
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
      .select("code, label, active, notes, created_at")
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
      active: data.active,
    });
    if (error) dbError(error);
    return { ok: true };
  });

/** Admin: update label/notes/active on an existing promo code (code itself immutable). */
export const updatePromoCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        code: codeSchema,
        label: z.string().trim().min(1).max(120).optional(),
        notes: z.string().trim().max(500).nullable().optional(),
        active: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: { label?: string; notes?: string | null; active?: boolean } = {};
    if (data.label !== undefined) patch.label = data.label;
    if (data.notes !== undefined) patch.notes = data.notes;
    if (data.active !== undefined) patch.active = data.active;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabaseAdmin
      .from("promo_codes")
      .update(patch)
      .eq("code", data.code);

    if (error) dbError(error);
    return { ok: true };
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
