import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rethrowPlain } from "./api/errors";
import { dbError } from "./db-error";
import { feedbackInput, submitFeedback as submitFeedbackShared } from "./feedback.server";

export { feedbackInput };

async function assertAdmin(context: { userId: string; supabase: any }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
}

/*
 * `submitFeedback` is a thin wrapper over src/lib/feedback.server.ts, shared
 * with `POST /api/v1/feedback` (PRD §7.12). Behavior is unchanged.
 * `listFeedback` and `setFeedbackResolved` are admin-only and stay web-only.
 */
export const submitFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => feedbackInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      return await submitFeedbackShared({ userId: context.userId, admin: supabaseAdmin }, data);
    } catch (err) {
      rethrowPlain(err);
    }
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
