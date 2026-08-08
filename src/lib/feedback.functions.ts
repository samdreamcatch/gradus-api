import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";

const submitSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  path: z.string().max(500).optional().nullable(),
  userAgent: z.string().max(500).optional().nullable(),
  viewport: z.string().max(32).optional().nullable(),
});

async function assertAdmin(context: { userId: string; supabase: any }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
}

async function detectRole(
  supabaseAdmin: any,
  userId: string,
): Promise<"coach" | "parent" | "athlete" | "admin" | "unknown"> {
  const [coach, parent, athlete, admin] = await Promise.all([
    supabaseAdmin
      .from("coach_profiles")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", userId),
    supabaseAdmin
      .from("parent_profiles")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", userId),
    supabaseAdmin
      .from("athletes")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", userId),
    supabaseAdmin
      .from("user_roles")
      .select("role", { head: true, count: "exact" })
      .eq("user_id", userId)
      .eq("role", "admin"),
  ]);
  if ((coach.count ?? 0) > 0) return "coach";
  if ((parent.count ?? 0) > 0) return "parent";
  if ((athlete.count ?? 0) > 0) return "athlete";
  if ((admin.count ?? 0) > 0) return "admin";
  return "unknown";
}

export const submitFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => submitSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const role = await detectRole(supabaseAdmin, context.userId);
    const { error } = await supabaseAdmin.from("feedback").insert({
      user_id: context.userId,
      role,
      message: data.message,
      path: data.path ?? null,
      user_agent: data.userAgent ?? null,
      viewport: data.viewport ?? null,
    });
    if (error) dbError(error);
    return { ok: true };
  });

const listSchema = z.object({
  unresolvedOnly: z.boolean().default(false),
});

export const listFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => listSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("feedback")
      .select("id, user_id, role, message, path, user_agent, viewport, resolved_at, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.unresolvedOnly) q = q.is("resolved_at", null);
    const { data: rows, error } = await q;
    if (error) dbError(error);

    const userIds = Array.from(new Set((rows ?? []).map((r: any) => r.user_id)));
    const [coaches, parents, athletes] = await Promise.all([
      supabaseAdmin
        .from("coach_profiles")
        .select("user_id, first_name, last_name, is_test")
        .in("user_id", userIds),
      supabaseAdmin
        .from("parent_profiles")
        .select("user_id, first_name, last_name, is_test")
        .in("user_id", userIds),
      supabaseAdmin
        .from("athletes")
        .select("user_id, first_name, last_name, parent_id")
        .in("user_id", userIds),
    ]);

    const profileFor = (uid: string) => {
      const c = (coaches.data ?? []).find((x: any) => x.user_id === uid);
      if (c)
        return {
          name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Coach",
          isTest: !!c.is_test,
        };
      const p = (parents.data ?? []).find((x: any) => x.user_id === uid);
      if (p)
        return {
          name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Parent",
          isTest: !!p.is_test,
        };
      const a = (athletes.data ?? []).find((x: any) => x.user_id === uid);
      if (a)
        return {
          name: `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() || "Athlete",
          isTest: false,
        };
      return { name: "Unknown", isTest: false };
    };

    return {
      items: (rows ?? []).map((r: any) => ({
        ...r,
        ...profileFor(r.user_id),
      })),
    };
  });

export const setFeedbackResolved = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), resolved: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("feedback")
      .update({ resolved_at: data.resolved ? new Date().toISOString() : null })
      .eq("id", data.id);
    if (error) dbError(error);
    return { ok: true };
  });
