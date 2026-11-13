/**
 * Plan reports (migration 20261113110000_plan_reports): "Report this plan" on
 * a marketplace plan. The reporter says what's wrong (inappropriate content, a
 * misleading listing, or an unsafe instruction) and may add a note; the safety
 * inbox is emailed and an admin reviews it, as with user reports
 * (src/lib/safety.server.ts).
 *
 * Anyone who can see the plan may report it: it's a marketplace listing (an
 * active plan by a Coach Pro coach, as in marketplace-plans.server.ts), or the
 * caller can read it themselves (their own copy). Never the plan's coach.
 * Reporting again while the first report is open files nothing new.
 *
 * `plan_reports` isn't in the generated types until Lovable regenerates them,
 * so it goes through `untyped`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import { buildAppEmailPayload } from "./email-queue-payload";
import {
  PLAN_REPORT_REASON_LABELS,
  type listPlanReportsInput,
  type PlanReportDTO,
  type PlanReportReason,
  type PlanReportStatus,
  type reportPlanInput,
  type updatePlanReportInput,
} from "./plan-reports-types";
import { ALERT_RECIPIENTS, resolveIdentity } from "./safety.server";

type Client = SupabaseClient<Database>;

type Untyped = { from: (table: string) => any };
const untyped = (client: Client) => client as unknown as Untyped;

export type PlanReportsContext = { userId: string; supabase: Client; admin: Client };

export interface ReportPlanResultDTO {
  ok: true;
  reportId: string;
  /** The caller had already reported this plan and it's still open: nothing new was filed. */
  alreadyReported: boolean;
}

const notFound = () => new ApiError({ code: "not_found", status: 404, message: "Plan not found" });

type PlanForReport = {
  id: string;
  title: string | null;
  status: string;
  coach_id: string | null;
  coach: {
    user_id: string;
    first_name: string | null;
    last_name: string | null;
    subscription_tier: string | null;
    organization_id: string | null;
  } | null;
};

/**
 * The plan, when the caller may report it: a marketplace listing, or one they
 * can read themselves. Anyone else gets 404, so this never reveals a plan.
 */
async function loadReportablePlan(ctx: PlanReportsContext, planId: string): Promise<PlanForReport> {
  const [visible, plan] = await Promise.all([
    ctx.supabase.from("plans").select("id").eq("id", planId).maybeSingle(),
    untyped(ctx.admin)
      .from("plans")
      .select(
        "id, title, status, coach_id, coach:coach_profiles(user_id, first_name, last_name, subscription_tier, organization_id)",
      )
      .eq("id", planId)
      .maybeSingle(),
  ]);
  if (visible.error) dbError(visible.error);
  if (plan.error) dbError(plan.error);
  const row = plan.data as PlanForReport | null;
  if (!row) throw notFound();
  const listed =
    row.status === "active" &&
    row.coach?.subscription_tier === "coach_pro" &&
    row.coach.organization_id === null;
  if (!visible.data && !listed) throw notFound();
  return row;
}

/** Files the caller's report of a plan and emails the safety inbox. */
export async function reportPlan(
  ctx: PlanReportsContext,
  planId: string,
  input: z.infer<typeof reportPlanInput>,
): Promise<ReportPlanResultDTO> {
  const plan = await loadReportablePlan(ctx, planId);
  if (plan.coach?.user_id === ctx.userId) {
    throw new ApiError({
      code: "unprocessable",
      status: 422,
      message: "You can't report your own plan.",
    });
  }

  const { data: open, error: openError } = await untyped(ctx.admin)
    .from("plan_reports")
    .select("id")
    .eq("plan_id", plan.id)
    .eq("reporter_user_id", ctx.userId)
    .eq("status", "open")
    .maybeSingle();
  if (openError) dbError(openError);
  if (open) return { ok: true, reportId: open.id as string, alreadyReported: true };

  const title = plan.title?.trim() || "Untitled plan";
  const { data: inserted, error } = await untyped(ctx.admin)
    .from("plan_reports")
    .insert({
      plan_id: plan.id,
      plan_title: title,
      coach_id: plan.coach_id,
      reporter_user_id: ctx.userId,
      reason: input.reason,
      note: input.note,
    })
    .select("id")
    .single();
  if (error) dbError(error, "Couldn't send this report");
  const reportId = (inserted as { id: string }).id;

  const coachName =
    [plan.coach?.first_name, plan.coach?.last_name].filter(Boolean).join(" ").trim() ||
    "Unknown coach";
  await sendPlanReportAlert(ctx.admin, {
    reportId,
    reason: input.reason,
    note: input.note,
    planTitle: title,
    planId: plan.id,
    coachName,
    reporterUserId: ctx.userId,
  });
  return { ok: true, reportId, alreadyReported: false };
}

/** Emails the safety inbox through the transactional email queue; never throws. */
async function sendPlanReportAlert(
  admin: Client,
  opts: {
    reportId: string;
    reason: PlanReportReason;
    note: string;
    planTitle: string;
    planId: string;
    coachName: string;
    reporterUserId: string;
  },
): Promise<void> {
  try {
    const reporter = await resolveIdentity(admin, opts.reporterUserId);
    const label = PLAN_REPORT_REASON_LABELS[opts.reason];
    // An unsafe drill can hurt someone: it goes to the top of the inbox.
    const subject = `${opts.reason === "unsafe" ? "[URGENT] " : ""}[Gradus plan report] ${label} — ${opts.planTitle}`;
    const lines = [
      `Reason: ${label}`,
      `Plan: ${opts.planTitle} (${opts.planId})`,
      `Coach: ${opts.coachName}`,
      `Reporter: ${reporter.name} (${reporter.role})`,
      opts.note ? `Note: ${opts.note}` : null,
      `Review: https://gradus.training/admin/reports`,
    ].filter(Boolean) as string[];
    const text = lines.join("\n");
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6">${lines
      .map((l) => `<p style="margin:0 0 6px">${esc(l)}</p>`)
      .join("")}</div>`;

    for (const to of ALERT_RECIPIENTS) {
      const messageId = `plan-report-${opts.reportId}-${to}`;
      const { error: pendingError } = await untyped(admin).from("email_send_log").insert({
        message_id: messageId,
        template_name: "plan-report",
        recipient_email: to,
        status: "pending",
      });
      if (pendingError) continue;
      const payload = buildAppEmailPayload({
        messageId,
        to,
        from: `Gradus Training <noreply@gradussports.com>`,
        senderDomain: "support.gradussports.com",
        subject,
        html,
        text,
        label: "plan-report",
        idempotencyKey: messageId,
      });
      await (admin as unknown as { rpc: (fn: string, args: object) => Promise<unknown> }).rpc(
        "enqueue_email",
        { queue_name: "transactional_emails", payload },
      );
    }
  } catch (err) {
    console.error("[plan-reports] report alert failed", err);
  }
}

/* ------------------------------------------------------------------ admin */

type ReportRow = {
  id: string;
  plan_id: string | null;
  plan_title: string;
  coach_id: string | null;
  reporter_user_id: string;
  reason: PlanReportReason;
  note: string;
  status: PlanReportStatus;
  admin_notes: string;
  created_at: string;
  updated_at: string;
};

/** Plan reports for the admin, newest first (200 at most). The caller must already be an admin. */
export async function listPlanReports(
  admin: Client,
  input: z.infer<typeof listPlanReportsInput>,
): Promise<PlanReportDTO[]> {
  let query = untyped(admin)
    .from("plan_reports")
    .select(
      "id, plan_id, plan_title, coach_id, reporter_user_id, reason, note, status, admin_notes, created_at, updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (input.openOnly) query = query.eq("status", "open");
  const { data, error } = await query;
  if (error) dbError(error);
  const rows = (data ?? []) as ReportRow[];

  const coachIds = [...new Set(rows.map((r) => r.coach_id).filter(Boolean))] as string[];
  const coaches = new Map<string, string>();
  if (coachIds.length) {
    const { data: found, error: coachError } = await admin
      .from("coach_profiles")
      .select("id, first_name, last_name")
      .in("id", coachIds);
    if (coachError) dbError(coachError);
    for (const c of found ?? []) {
      coaches.set(c.id, [c.first_name, c.last_name].filter(Boolean).join(" ").trim());
    }
  }
  const reporters = new Map<string, { name: string; role: string }>();
  for (const id of new Set(rows.map((r) => r.reporter_user_id))) {
    const who = await resolveIdentity(admin, id);
    reporters.set(id, { name: who.name, role: who.role });
  }

  return rows.map((r) => ({
    id: r.id,
    planId: r.plan_id,
    planTitle: r.plan_title,
    coachId: r.coach_id,
    coachName: r.coach_id ? (coaches.get(r.coach_id) ?? null) : null,
    reporter: {
      userId: r.reporter_user_id,
      ...(reporters.get(r.reporter_user_id) ?? { name: "Unknown", role: "unknown" }),
    },
    reason: r.reason,
    note: r.note,
    status: r.status,
    adminNotes: r.admin_notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/** An admin closes or reopens a plan report. The caller must already be an admin. */
export async function updatePlanReport(
  admin: Client,
  input: z.infer<typeof updatePlanReportInput>,
): Promise<{ ok: true }> {
  const { data, error } = await untyped(admin)
    .from("plan_reports")
    .update({
      status: input.status,
      ...(input.adminNotes !== undefined ? { admin_notes: input.adminNotes } : {}),
    })
    .eq("id", input.id)
    .select("id")
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw new ApiError({ code: "not_found", status: 404, message: "Report not found" });
  return { ok: true };
}
