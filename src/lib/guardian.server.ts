/**
 * Server-only helpers for the "guardian on file" flow.
 *
 * A youth athlete can be active in Gradus before their parent has an account,
 * as long as a guardian email is on file. The guardian receives an invite with
 * a claim link plus copies of coach communications until they claim the
 * athlete, at which point they become a normal parent account.
 */
import { siteUrl } from "@/lib/site-url";
import * as React from "react";
import { render } from "@react-email/render";
import { GuardianInviteEmail, guardianInviteSubject } from "./email-templates/guardian-invite";
import { AthleteInviteEmail, athleteInviteSubject } from "./email-templates/athlete-invite";
import {
  GuardianActivityEmail,
  guardianActivitySubject,
} from "./email-templates/guardian-activity";
import { RetentionNoticeEmail, retentionNoticeSubject } from "./email-templates/retention-notice";
import { fetchOverridesFor } from "./email-templates/overrides.server";
import { buildAppEmailPayload } from "./email-queue-payload";

const SITE_NAME = "Gradus Training";
const SENDER_DOMAIN = "support.gradussports.com";
const FROM_DOMAIN = "gradussports.com";
export const SITE_URL = siteUrl();

export function guardianClaimUrl(token: string): string {
  return `${SITE_URL}/g/${token}`;
}

export function newGuardianToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The same queue for other app emails (the team's "Request a sport" notice). */
export async function enqueueAppEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  label: string;
}): Promise<boolean> {
  return enqueue(opts);
}

/** True when the message reached the queue; false is logged, never thrown, for the invite paths. */
async function enqueue(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  label: string;
}): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const messageId = `${opts.label}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

  const { error: pendingError } = await supabaseAdmin.from("email_send_log").insert({
    message_id: messageId,
    template_name: opts.label,
    recipient_email: opts.to,
    status: "pending",
  });
  if (pendingError) {
    console.error("[guardian] pending log failed (%s)", opts.label, pendingError);
    return false;
  }

  const payload = buildAppEmailPayload({
    messageId,
    to: opts.to,
    from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
    senderDomain: SENDER_DOMAIN,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    label: opts.label,
    idempotencyKey: messageId,
  });

  const { error } = await supabaseAdmin.rpc("enqueue_email", {
    queue_name: "transactional_emails",
    payload,
  });

  if (!error) {
    const { enqueueCopies } = await import("./email-templates/delivery.server");
    await enqueueCopies(supabaseAdmin as any, {
      templateName: opts.label,
      queueName: "transactional_emails",
      payload,
    });
  }

  if (error) {
    console.error("[guardian] enqueue failed (%s)", opts.label, error);
    await supabaseAdmin.from("email_send_log").insert({
      message_id: messageId,
      template_name: opts.label,
      recipient_email: opts.to,
      status: "failed",
      error_message: error.message,
    });
    return false;
  }
  return true;
}

/**
 * True when the address belongs to a Gradus parent account with a confirmed
 * email (migration 20261008130000). The guardian emails then say "Sign in to
 * confirm" instead of "Create your account", which used to send an existing
 * parent into a sign-up that failed (beta feedback 2026-10-07). False on any
 * error, including before Lovable applies the migration: the old copy.
 */
export async function guardianHasParentAccount(email: string): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any).rpc("parent_account_for_email", {
      p_email: email,
    });
    if (error) return false;
    return typeof data === "string" && data.length > 0;
  } catch {
    return false;
  }
}

/** Send (or re-send) the guardian invite for an athlete. Never throws. */
export async function sendGuardianInvite(params: {
  to: string;
  athleteName: string;
  coachName?: string | null;
  token: string;
  /** Whose inbox this is — drives athlete-voiced vs guardian-voiced copy. */
  recipient?: "guardian" | "athlete";
}): Promise<void> {
  try {
    const isAthlete = params.recipient === "athlete";
    const label = isAthlete ? "athlete-invite" : "guardian-invite";
    const copyOverrides = await fetchOverridesFor(label);
    const existingAccount = !isAthlete && (await guardianHasParentAccount(params.to));
    const element = React.createElement(isAthlete ? AthleteInviteEmail : GuardianInviteEmail, {
      athleteName: params.athleteName,
      coachName: params.coachName ?? null,
      claimUrl: guardianClaimUrl(params.token),
      siteUrl: SITE_URL,
      copyOverrides,
      existingAccount,
    });
    const html = await render(element);
    const text = await render(element, { plainText: true });
    await enqueue({
      to: params.to,
      subject: (isAthlete ? athleteInviteSubject : guardianInviteSubject)(
        { athleteName: params.athleteName, coachName: params.coachName ?? null },
        copyOverrides,
      ),
      html,
      text,
      label,
    });
  } catch (e) {
    console.error("[guardian] invite render/send failed", e);
  }
}

/** Mirror a room message to an unclaimed guardian. Never throws. */
export async function sendGuardianMessageCopy(params: {
  to: string;
  athleteName: string;
  senderName: string;
  senderRole: "coach" | "athlete";
  body: string;
  token: string;
}): Promise<void> {
  try {
    const copyOverrides = await fetchOverridesFor("guardian-activity");
    const element = React.createElement(GuardianActivityEmail, {
      athleteName: params.athleteName,
      senderName: params.senderName,
      senderRole: params.senderRole,
      body: params.body,
      claimUrl: guardianClaimUrl(params.token),
      siteUrl: SITE_URL,
      copyOverrides,
      existingAccount: await guardianHasParentAccount(params.to),
    });
    const html = await render(element);
    const text = await render(element, { plainText: true });
    await enqueue({
      to: params.to,
      subject: guardianActivitySubject(
        {
          athleteName: params.athleteName,
          senderName: params.senderName,
          senderRole: params.senderRole,
        },
        copyOverrides,
      ),
      html,
      text,
      label: "guardian-activity",
    });
  } catch (e) {
    console.error("[guardian] message copy failed", e);
  }
}

/**
 * Shared entry point for "guardian on file" activity emails.
 *
 * Resolves eligibility (guardian email + claim token on file, no parent
 * account, unclaimed) and the sender's display name, then mirrors the
 * activity. Never throws — callers run this after their write commits.
 */
export async function mirrorGuardianActivity(params: {
  athleteId: string;
  senderRole: "coach" | "athlete";
  /** Required when senderRole is "coach" — used to resolve the coach name. */
  coachId?: string | null;
  body: string;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: athlete } = await supabaseAdmin
      .from("athletes")
      .select(
        "first_name, last_name, parent_id, guardian_email, guardian_claimed_at, guardian_claim_token",
      )
      .eq("id", params.athleteId)
      .maybeSingle();

    if (
      !athlete?.guardian_email ||
      !athlete.guardian_claim_token ||
      athlete.parent_id ||
      athlete.guardian_claimed_at
    ) {
      return;
    }

    const athleteName = `${athlete.first_name} ${athlete.last_name}`.trim();

    let senderName = athleteName || "Your athlete";
    if (params.senderRole === "coach") {
      // The bare name: the template's `coachLabel` adds "Coach" once, and
      // reads "Your athlete's coach" when there's no name.
      senderName = "";
      if (params.coachId) {
        const { data: coach } = await supabaseAdmin
          .from("coach_profiles")
          .select("first_name, last_name")
          .eq("id", params.coachId)
          .maybeSingle();
        if (coach) senderName = `${coach.first_name ?? ""} ${coach.last_name ?? ""}`.trim();
      }
    }

    await sendGuardianMessageCopy({
      to: athlete.guardian_email,
      athleteName,
      senderName,
      senderRole: params.senderRole,
      body: params.body,
      token: athlete.guardian_claim_token,
    });
  } catch (e) {
    console.error("[guardian] activity mirror failed", e);
  }
}

/** "November 2, 2026": the day the dormant sweep will delete the account, in UTC. */
export function formatDeleteDate(deleteOn: Date): string {
  return deleteOn.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The dormant-account notice (retention policy, PRD §6.13 A9, decision #41):
 * thirty days' warning to a guardian on file. Unlike the invite senders this
 * THROWS when the email did not reach the queue: the sweep must not stamp a
 * notice nobody received.
 */
export async function sendRetentionNotice(params: {
  to: string;
  athleteName: string;
  deleteOn: Date;
}): Promise<void> {
  {
    const copyOverrides = await fetchOverridesFor("retention-notice");
    const data = {
      athleteName: params.athleteName,
      deleteDate: formatDeleteDate(params.deleteOn),
      siteUrl: SITE_URL,
    };
    const element = React.createElement(RetentionNoticeEmail, { ...data, copyOverrides });
    const html = await render(element);
    const text = await render(element, { plainText: true });
    const queued = await enqueue({
      to: params.to,
      subject: retentionNoticeSubject(data, copyOverrides),
      html,
      text,
      label: "retention-notice",
    });
    if (!queued) throw new Error(`retention notice to ${params.to} was not queued`);
  }
}
