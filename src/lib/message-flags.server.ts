/**
 * Server side of the message check (PRD decision #64): recording flags,
 * emailing support, and the admin's messaging pause.
 *
 * Everything here is best effort and tolerant of the tables not existing
 * yet: migrations are applied by hand in Lovable, sometimes after the code
 * is published, and a send must never fail because a flag couldn't be saved.
 */
import { buildAppEmailPayload } from "./email-queue-payload";
import { FLAG_OUTCOME_LABELS, flagDelivered, type FlagOutcome } from "./message-flags";
import { MESSAGE_CATEGORY_INFO, type MessageMatch } from "./message-rules";
import { resolveIdentity } from "./safety.server";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Mariah, 2026-11-10: every flag emails support@. */
const FLAG_ALERT_RECIPIENTS = ["support@gradussports.com"];
const SITE_NAME = "Gradus Training";
const SENDER_DOMAIN = "support.gradussports.com";
const FROM_DOMAIN = "gradussports.com";
const SITE_URL = "https://gradus.training";

/** Postgres "relation does not exist" / PostgREST "table not in schema cache". */
function missingTable(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

export async function isMessagingSuspended(admin: any, userId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("messaging_suspensions")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (!missingTable(error)) console.error("[message-flags] suspension lookup failed", error);
    return false;
  }
  return !!data;
}

export type RecordFlagInput = {
  senderUserId: string;
  senderRole: string;
  senderMinor: boolean;
  /** Null when the text never reached a room (a competition recap that was stopped). */
  roomId: string | null;
  roomKind: "athlete" | string;
  roomHasMinor: boolean;
  coachId: string | null;
  body: string;
  match: MessageMatch;
  outcome: FlagOutcome;
  messageId: string | null;
};

/**
 * Saves one flag and emails support. A "Send anyway" upgrades the stopped
 * attempt it follows instead of adding a second row; a repeat of the same
 * stopped text within ten minutes is not recorded twice. Never throws, and a
 * failed look-back never costs the flag: it is inserted anyway.
 */
export async function recordMessageFlag(admin: any, input: RecordFlagInput): Promise<void> {
  try {
    const roomColumn = input.roomKind === "athlete" ? "room_id" : "direct_room_id";
    const minutes = input.outcome === "sent_anyway" ? 24 * 60 : 10;

    // The sender's recent stopped attempts, compared here: the text can be 4,000
    // characters, too long to put in a query string.
    let earlierId: string | null = null;
    if (input.outcome !== "sent") {
      const { data: recent, error: recentErr } = await admin
        .from("message_flags")
        .select("id, body, room_id, direct_room_id")
        .eq("sender_user_id", input.senderUserId)
        .eq("outcome", "stopped")
        .gte("created_at", new Date(Date.now() - minutes * 60_000).toISOString())
        .order("created_at", { ascending: false })
        .limit(50);
      if (recentErr) {
        if (missingTable(recentErr)) return;
        console.error("[message-flags] look-back failed", recentErr);
      }
      const same = (recent ?? []).find(
        (r: any) => r.body === input.body && (r[roomColumn] ?? null) === input.roomId,
      );
      earlierId = same?.id ?? null;
    }

    let flagId: string | null = null;
    if (earlierId && input.outcome === "stopped") return;
    if (earlierId && input.outcome === "sent_anyway") {
      const { error } = await admin
        .from("message_flags")
        .update({ outcome: "sent_anyway", message_id: input.messageId, status: "open" })
        .eq("id", earlierId);
      if (error) console.error("[message-flags] upgrade failed", error);
      else flagId = earlierId;
    }
    if (!flagId) {
      const { data: row, error } = await admin
        .from("message_flags")
        .insert({
          sender_user_id: input.senderUserId,
          sender_role: input.senderRole,
          sender_minor: input.senderMinor,
          ...(input.roomId ? { [roomColumn]: input.roomId } : {}),
          room_has_minor: input.roomHasMinor,
          coach_id: input.coachId,
          message_id: input.messageId,
          body: input.body,
          category: input.match.category,
          rule_id: input.match.ruleId,
          matched: input.match.matched,
          outcome: input.outcome,
        })
        .select("id")
        .single();
      if (error) {
        if (!missingTable(error)) console.error("[message-flags] insert failed", error);
        return;
      }
      flagId = row.id;
    }
    await sendFlagAlert(admin, flagId!, input);
  } catch (err) {
    console.error("[message-flags] record failed", err);
  }
}

/** The alert to the support inbox, through the existing `user-report` email (no new template). */
async function sendFlagAlert(admin: any, flagId: string, input: RecordFlagInput): Promise<void> {
  const sender = await resolveIdentity(admin, input.senderUserId);
  const category = MESSAGE_CATEGORY_INFO[input.match.category].label;
  const urgent =
    flagDelivered({ outcome: input.outcome, category: input.match.category }) ||
    input.match.category === "self_harm";
  const who = `${sender.name} (${input.senderRole}${input.senderMinor ? ", under 18" : ""})`;
  const subject = `${urgent ? "[URGENT] " : ""}[Gradus flag] ${category} — ${FLAG_OUTCOME_LABELS[input.outcome]} — ${sender.name}`;
  const lines = [
    `Category: ${category} (rule ${input.match.ruleId})`,
    `Outcome: ${FLAG_OUTCOME_LABELS[input.outcome]}`,
    `Sender: ${who}`,
    `Room has an athlete under 18: ${input.roomHasMinor ? "yes" : "no"}`,
    `Message: ${input.body}`,
    `Review: ${SITE_URL}/admin/reports`,
  ];
  const text = lines.join("\n");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6">${lines
    .map((l) => `<p style="margin:0 0 6px">${esc(l)}</p>`)
    .join("")}</div>`;

  for (const to of FLAG_ALERT_RECIPIENTS) {
    const messageId = `message-flag-${flagId}-${input.outcome}-${to}`;
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
}
