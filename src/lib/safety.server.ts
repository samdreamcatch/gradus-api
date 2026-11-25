/**
 * Server-only helpers for trust & safety (reporting and blocking).
 *
 * Blocking in Gradus is a full disconnect: messaging stops in both directions
 * and any coaching relationship between the two people is severed. History is
 * preserved — nothing is deleted from `messages`.
 */
import { siteUrl } from "@/lib/site-url";
import { z } from "zod";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import { buildAppEmailPayload } from "./email-queue-payload";
import { REPORT_REASON_LABELS, reportInput, type ReportReason } from "./safety-types";

/** Who gets safety reports (people, messages, resources and plans). */
export const ALERT_RECIPIENTS = ["alyson@gradussports.com"];
const SITE_NAME = "Gradus Training";
const SENDER_DOMAIN = "support.gradussports.com";
const FROM_DOMAIN = "gradussports.com";
const SITE_URL = siteUrl();

export type SafetyIdentity = {
  userId: string;
  coachId: string | null;
  parentId: string | null;
  athleteId: string | null;
  name: string;
  role: "coach" | "parent" | "athlete" | "unknown";
};

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function resolveIdentity(admin: any, userId: string): Promise<SafetyIdentity> {
  const [coach, parent, athlete] = await Promise.all([
    admin
      .from("coach_profiles")
      .select("id, first_name, last_name")
      .eq("user_id", userId)
      .maybeSingle(),
    admin
      .from("parent_profiles")
      .select("id, first_name, last_name")
      .eq("user_id", userId)
      .maybeSingle(),
    admin.from("athletes").select("id, first_name, last_name").eq("user_id", userId).maybeSingle(),
  ]);

  const row = coach.data ?? parent.data ?? athlete.data ?? null;
  const name = row ? `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() : "";

  return {
    userId,
    coachId: coach.data?.id ?? null,
    parentId: parent.data?.id ?? null,
    athleteId: athlete.data?.id ?? null,
    name: name || "Unknown user",
    role: coach.data ? "coach" : parent.data ? "parent" : athlete.data ? "athlete" : "unknown",
  };
}

/** Remove a coach↔athlete relationship and all coach-scoped athlete data. */
async function severCoachAthlete(admin: any, coachId: string, athleteId: string): Promise<void> {
  await Promise.all([
    admin.from("athlete_lesson_slots").delete().eq("athlete_id", athleteId).eq("coach_id", coachId),
    admin
      .from("athlete_primary_coaches")
      .delete()
      .eq("athlete_id", athleteId)
      .eq("coach_id", coachId),
    admin.from("athlete_goals").delete().eq("athlete_id", athleteId).eq("coach_id", coachId),
    admin
      .from("athlete_coach_visibility")
      .delete()
      .eq("athlete_id", athleteId)
      .eq("coach_id", coachId),
    admin.from("coach_athlete_sports").delete().eq("athlete_id", athleteId).eq("coach_id", coachId),
  ]);
  await admin.from("coach_athletes").delete().eq("athlete_id", athleteId).eq("coach_id", coachId);
}

/**
 * Sever every coaching relationship between two people. Safe to call when no
 * relationship exists.
 */
export async function severRelationships(
  admin: any,
  a: SafetyIdentity,
  b: SafetyIdentity,
): Promise<void> {
  const pairs: { coachId: string; athleteId: string }[] = [];

  const collectForParent = async (coachId: string, parentId: string) => {
    const { data } = await admin.from("athletes").select("id").eq("parent_id", parentId);
    for (const row of data ?? []) pairs.push({ coachId, athleteId: row.id });
  };

  if (a.coachId && b.athleteId) pairs.push({ coachId: a.coachId, athleteId: b.athleteId });
  if (b.coachId && a.athleteId) pairs.push({ coachId: b.coachId, athleteId: a.athleteId });
  if (a.coachId && b.parentId) await collectForParent(a.coachId, b.parentId);
  if (b.coachId && a.parentId) await collectForParent(b.coachId, a.parentId);

  for (const p of pairs) await severCoachAthlete(admin, p.coachId, p.athleteId);

  // Coach ↔ coach visibility links get declined on both sides.
  if (a.coachId && b.coachId) {
    await admin
      .from("coach_visibility_links")
      .update({ a_status: "declined", b_status: "declined" })
      .or(
        `and(coach_a_id.eq.${a.coachId},coach_b_id.eq.${b.coachId}),and(coach_a_id.eq.${b.coachId},coach_b_id.eq.${a.coachId})`,
      );
  }
}

/** Every user id the given user has blocked, or been blocked by. */
export async function blockedUserIds(admin: any, userId: string): Promise<Set<string>> {
  const { data } = await admin
    .from("user_blocks")
    .select("blocker_user_id, blocked_user_id")
    .or(`blocker_user_id.eq.${userId},blocked_user_id.eq.${userId}`);
  const out = new Set<string>();
  for (const row of data ?? []) {
    out.add(row.blocker_user_id === userId ? row.blocked_user_id : row.blocker_user_id);
  }
  return out;
}

/** Fire-and-forget alert to the Gradus safety inbox. Never throws. */
export async function sendReportAlert(
  admin: any,
  opts: {
    reportId: string;
    reason: ReportReason;
    note: string;
    reporter: SafetyIdentity;
    reported: SafetyIdentity;
    messageBody: string | null;
    resourceTitle?: string | null;
    blocked: boolean;
  },
): Promise<void> {
  try {
    const urgent = opts.reason === "minor_safety";
    const subject = `${urgent ? "[URGENT] " : ""}[Gradus report] ${
      REPORT_REASON_LABELS[opts.reason]
    } — ${opts.resourceTitle ?? opts.reported.name}`;

    const lines = [
      `Reason: ${REPORT_REASON_LABELS[opts.reason]}`,
      `Reported: ${opts.reported.name} (${opts.reported.role})`,
      `Reporter: ${opts.reporter.name} (${opts.reporter.role})`,
      `Also blocked: ${opts.blocked ? "yes" : "no"}`,
      opts.note ? `Note: ${opts.note}` : null,
      opts.messageBody ? `Reported message: ${opts.messageBody}` : null,
      opts.resourceTitle ? `Reported resource: ${opts.resourceTitle}` : null,
      `Review: ${SITE_URL}/admin/reports`,
    ].filter(Boolean) as string[];

    const text = lines.join("\n");
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6">${lines
      .map((l) => `<p style="margin:0 0 6px">${esc(l)}</p>`)
      .join("")}</div>`;

    for (const to of ALERT_RECIPIENTS) {
      const messageId = `user-report-${opts.reportId}-${to}`;
      const { error: pendingError } = await admin.from("email_send_log").insert({
        message_id: messageId,
        template_name: "user-report",
        recipient_email: to,
        status: "pending",
      });
      if (pendingError) continue;

      const payload = buildAppEmailPayload({
        messageId,
        to,
        from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
        senderDomain: SENDER_DOMAIN,
        subject,
        html,
        text,
        label: "user-report",
        idempotencyKey: messageId,
      });
      await admin.rpc("enqueue_email", { queue_name: "transactional_emails", payload });
    }
  } catch (err) {
    console.error("[safety] report alert failed", err);
  }
}

/* ------------------------------------------------------------------------ */
/* Shared block / report logic — the single source of truth for the web      */
/* server functions (safety.functions.ts) and the /api/v1/safety routes      */
/* (PRD §6.2 pattern, Appendix A "Messaging and safety"). Extracted from the  */
/* server functions without behavior changes; user-facing messages are kept  */
/* verbatim and carried on ApiError so the API gets stable codes.            */
/* ------------------------------------------------------------------------ */

export type BlockedUser = {
  userId: string;
  name: string;
  role: "coach" | "parent" | "athlete" | "unknown";
  blockedAt: string;
};

export type SafetyContext = { userId: string; admin: any };

export const blockInput = z.object({ targetUserId: z.string().uuid() });

/** Blocking is a full disconnect (see the header). */
export async function blockUser(
  ctx: SafetyContext,
  input: z.infer<typeof blockInput>,
): Promise<{ ok: true }> {
  if (input.targetUserId === ctx.userId) {
    throw new ApiError({
      code: "unprocessable",
      status: 422,
      message: "You can't block yourself.",
    });
  }
  const [me, them] = await Promise.all([
    resolveIdentity(ctx.admin, ctx.userId),
    resolveIdentity(ctx.admin, input.targetUserId),
  ]);

  const { error } = await ctx.admin
    .from("user_blocks")
    .upsert(
      { blocker_user_id: ctx.userId, blocked_user_id: input.targetUserId },
      { onConflict: "blocker_user_id,blocked_user_id" },
    );
  if (error) dbError(error, "Couldn't block this person");

  await severRelationships(ctx.admin, me, them);
  return { ok: true as const };
}

export async function unblockUser(
  ctx: SafetyContext,
  input: z.infer<typeof blockInput>,
): Promise<{ ok: true }> {
  const { error } = await ctx.admin
    .from("user_blocks")
    .delete()
    .eq("blocker_user_id", ctx.userId)
    .eq("blocked_user_id", input.targetUserId);
  if (error) dbError(error, "Couldn't unblock this person");
  return { ok: true as const };
}

export async function listBlocks(ctx: SafetyContext): Promise<{ blocks: BlockedUser[] }> {
  const { data: rows, error } = await ctx.admin
    .from("user_blocks")
    .select("blocked_user_id, created_at")
    .eq("blocker_user_id", ctx.userId)
    .order("created_at", { ascending: false });
  if (error) dbError(error);

  const blocks: BlockedUser[] = [];
  for (const row of rows ?? []) {
    const who = await resolveIdentity(ctx.admin, row.blocked_user_id);
    blocks.push({
      userId: row.blocked_user_id,
      name: who.name,
      role: who.role,
      blockedAt: row.created_at,
    });
  }
  return { blocks };
}

export { reportInput };

/**
 * Needs the caller's RLS client too: a resource report is only accepted for
 * a resource the caller can actually see.
 */
export async function submitReport(
  ctx: SafetyContext & { supabase: any },
  input: z.infer<typeof reportInput>,
): Promise<{ ok: true; blocked: boolean }> {
  if (input.targetUserId && input.targetUserId === ctx.userId) {
    throw new ApiError({
      code: "unprocessable",
      status: 422,
      message: "You can't report yourself.",
    });
  }
  const admin = ctx.admin;

  // Resource reports are about content, not a person: never block.
  const alsoBlock = input.resourceId ? false : input.alsoBlock;

  let resourceTitle: string | null = null;
  let reportedUserId = input.targetUserId ?? null;
  if (input.resourceId) {
    // RLS on the caller's client enforces that they can actually see it.
    const { data: res, error: resErr } = await ctx.supabase
      .from("resources")
      .select("id, title, kind, coach_id")
      .eq("id", input.resourceId)
      .maybeSingle();
    if (resErr) dbError(resErr);
    if (!res) throw new ApiError({ code: "not_found", status: 404, message: "Resource not found" });
    resourceTitle = `${res.title ?? "Untitled"} (${res.kind ?? "file"})`;

    if (!reportedUserId && res.coach_id) {
      const { data: owner } = await admin
        .from("coach_profiles")
        .select("user_id")
        .eq("id", res.coach_id)
        .maybeSingle();
      if (owner?.user_id && owner.user_id !== ctx.userId) reportedUserId = owner.user_id;
    }
  }

  const me = await resolveIdentity(admin, ctx.userId);
  const them = reportedUserId
    ? await resolveIdentity(admin, reportedUserId)
    : {
        userId: "",
        coachId: null,
        parentId: null,
        athleteId: null,
        name: "Gradus resource",
        role: "unknown" as const,
      };

  let messageBody: string | null = null;
  if (input.messageId) {
    const { data: msg } = await admin
      .from("messages")
      .select("body, kind")
      .eq("id", input.messageId)
      .maybeSingle();
    if (msg) messageBody = msg.kind === "voice" ? "(voice note)" : (msg.body ?? "");
  }

  const { data: inserted, error } = await admin
    .from("user_reports")
    .insert({
      reporter_user_id: ctx.userId,
      reported_user_id: reportedUserId,
      message_id: input.messageId ?? null,
      resource_id: input.resourceId ?? null,
      reason: input.reason,
      note: input.note,
    })
    .select("id")
    .single();
  if (error) dbError(error, "Couldn't submit this report");

  if (alsoBlock && reportedUserId) {
    await admin
      .from("user_blocks")
      .upsert(
        { blocker_user_id: ctx.userId, blocked_user_id: reportedUserId },
        { onConflict: "blocker_user_id,blocked_user_id" },
      );
    await severRelationships(admin, me, them);
  }

  await sendReportAlert(admin, {
    reportId: inserted!.id,
    reason: input.reason,
    note: input.note,
    reporter: me,
    reported: them,
    messageBody,
    resourceTitle,
    blocked: alsoBlock,
  });

  return { ok: true as const, blocked: alsoBlock };
}
