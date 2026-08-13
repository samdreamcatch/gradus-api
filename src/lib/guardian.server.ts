/**
 * Server-only helpers for the "guardian on file" flow.
 *
 * A youth athlete can be active in Gradus before their parent has an account,
 * as long as a guardian email is on file. The guardian receives an invite with
 * a claim link plus copies of coach communications until they claim the
 * athlete, at which point they become a normal parent account.
 */
import * as React from "react";
import { render } from "@react-email/render";
import { GuardianInviteEmail, guardianInviteSubject } from "./email-templates/guardian-invite";
import {
  GuardianActivityEmail,
  guardianActivitySubject,
} from "./email-templates/guardian-activity";
import { fetchOverridesFor } from "./email-templates/overrides.server";

const SITE_NAME = "gradustraining";
const SENDER_DOMAIN = "support.gradussports.com";
const FROM_DOMAIN = "gradussports.com";
export const SITE_URL = "https://gradus.training";

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

async function enqueue(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  label: string;
}): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const messageId = `${opts.label}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

  await supabaseAdmin.from("email_send_log").insert({
    message_id: messageId,
    template_name: opts.label,
    recipient_email: opts.to,
    status: "pending",
  });

  const { error } = await supabaseAdmin.rpc("enqueue_email", {
    queue_name: "transactional_emails",
    payload: {
      run_id: messageId,
      message_id: messageId,
      to: opts.to,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      purpose: "transactional",
      label: opts.label,
      queued_at: new Date().toISOString(),
    },
  });

  if (error) {
    console.error(`[guardian] enqueue failed (${opts.label})`, error);
    await supabaseAdmin.from("email_send_log").insert({
      message_id: messageId,
      template_name: opts.label,
      recipient_email: opts.to,
      status: "failed",
      error_message: error.message,
    });
  }
}

/** Send (or re-send) the guardian invite for an athlete. Never throws. */
export async function sendGuardianInvite(params: {
  to: string;
  athleteName: string;
  coachName?: string | null;
  token: string;
}): Promise<void> {
  try {
    const copyOverrides = await fetchOverridesFor("guardian-invite");
    const element = React.createElement(GuardianInviteEmail, {
      athleteName: params.athleteName,
      coachName: params.coachName ?? null,
      claimUrl: guardianClaimUrl(params.token),
      siteUrl: SITE_URL,
      copyOverrides,
    });
    const html = await render(element);
    const text = await render(element, { plainText: true });
    await enqueue({
      to: params.to,
      subject: guardianInviteSubject(
        { athleteName: params.athleteName, coachName: params.coachName ?? null },
        copyOverrides,
      ),
      html,
      text,
      label: "guardian-invite",
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
