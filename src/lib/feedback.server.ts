/**
 * In-app feedback — the single source of truth for the web server function
 * (feedback.functions.ts `submitFeedback`) and the `POST /api/v1/feedback`
 * route (PRD §7.12 "Settings", Appendix A). Extracted without behavior
 * changes. The admin-only list/resolve functions stay in feedback.functions.ts.
 */
import { z } from "zod";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dbError } from "./db-error";

type Admin = typeof supabaseAdmin;

export type FeedbackContext = { userId: string; admin: Admin };

export type FeedbackRole = "coach" | "parent" | "athlete" | "admin" | "unknown";

export const feedbackInput = z.object({
  message: z.string().trim().min(1).max(2000),
  path: z.string().max(500).optional().nullable(),
  userAgent: z.string().max(500).optional().nullable(),
  viewport: z.string().max(32).optional().nullable(),
});

export type FeedbackInput = z.infer<typeof feedbackInput>;

/** The caller's role for the feedback row: coach > parent > athlete > admin > unknown. */
export async function detectRole(admin: Admin, userId: string): Promise<FeedbackRole> {
  const [coach, parent, athlete, adminRole] = await Promise.all([
    admin.from("coach_profiles").select("id", { head: true, count: "exact" }).eq("user_id", userId),
    admin
      .from("parent_profiles")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", userId),
    admin.from("athletes").select("id", { head: true, count: "exact" }).eq("user_id", userId),
    admin
      .from("user_roles")
      .select("role", { head: true, count: "exact" })
      .eq("user_id", userId)
      .eq("role", "admin"),
  ]);
  if ((coach.count ?? 0) > 0) return "coach";
  if ((parent.count ?? 0) > 0) return "parent";
  if ((athlete.count ?? 0) > 0) return "athlete";
  if ((adminRole.count ?? 0) > 0) return "admin";
  return "unknown";
}

/** `submitFeedback`: store one feedback message with the caller's detected role. */
export async function submitFeedback(
  ctx: FeedbackContext,
  input: FeedbackInput,
): Promise<{ ok: true }> {
  const { admin, userId } = ctx;
  const role = await detectRole(admin, userId);
  const { error } = await admin.from("feedback").insert({
    user_id: userId,
    role,
    message: input.message,
    path: input.path ?? null,
    user_agent: input.userAgent ?? null,
    viewport: input.viewport ?? null,
  });
  if (error) dbError(error);
  return { ok: true };
}
