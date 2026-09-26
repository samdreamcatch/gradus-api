/**
 * Server-only helpers for club (organization) lifecycle emails:
 *  - a coach is invited to a club plan by a club admin
 *  - a coach leaves, or is removed from, a club plan
 *
 * Both are best-effort: they log and swallow errors so they can never break
 * the admin action that triggered them.
 */
import * as React from "react";
import { render } from "@react-email/render";
import { ClubInviteEmail, clubInviteSubject } from "./email-templates/club-invite";
import { ClubRemovalEmail, clubRemovalSubject } from "./email-templates/club-removal";
import { fetchOverridesFor } from "./email-templates/overrides.server";
import { buildAppEmailPayload } from "./email-queue-payload";

const SITE_NAME = "Gradus Training";
const SENDER_DOMAIN = "support.gradussports.com";
const FROM_DOMAIN = "gradussports.com";
export const SITE_URL = "https://gradus.training";

async function enqueue(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  label: string;
}): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const messageId = `${opts.label}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

  const { error: pendingError } = await supabaseAdmin.from("email_send_log").insert({
    message_id: messageId,
    template_name: opts.label,
    recipient_email: opts.to,
    status: "pending",
  });
  if (pendingError) {
    console.error("[club-emails] pending log failed (%s)", opts.label, pendingError);
    return;
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

  if (error) {
    console.error("[club-emails] enqueue failed (%s)", opts.label, error);
    await supabaseAdmin.from("email_send_log").insert({
      message_id: messageId,
      template_name: opts.label,
      recipient_email: opts.to,
      status: "failed",
      error_message: error.message,
    });
    return;
  }

  const { enqueueCopies } = await import("./email-templates/delivery.server");
  await enqueueCopies(supabaseAdmin as any, {
    templateName: opts.label,
    queueName: "transactional_emails",
    payload,
  });
}

/** Invite (or re-invite) a coach to a club plan. Never throws. */
export async function sendClubCoachInvite(params: {
  to: string;
  orgName: string;
  inviteCode: string;
}): Promise<void> {
  try {
    const copyOverrides = await fetchOverridesFor("club-invite");
    const inviteUrl = `${SITE_URL}/i/${params.inviteCode}`;
    const element = React.createElement(ClubInviteEmail, {
      orgName: params.orgName,
      inviteCode: params.inviteCode,
      inviteUrl,
      siteUrl: SITE_URL,
      copyOverrides,
    });
    const html = await render(element);
    const text = await render(element, { plainText: true });
    await enqueue({
      to: params.to,
      subject: clubInviteSubject({ orgName: params.orgName }, copyOverrides),
      html,
      text,
      label: "club-invite",
    });
  } catch (e) {
    console.error("[club-emails] invite render/send failed", e);
  }
}

/** Tell a coach their club seat ended and how long they stay free. Never throws. */
export async function sendClubRemovalNotice(params: {
  to: string;
  firstName?: string | null;
  orgName: string;
  freeUntilIso: string;
}): Promise<void> {
  try {
    const copyOverrides = await fetchOverridesFor("club-removal");
    const freeUntil = new Date(params.freeUntilIso).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
    });
    const element = React.createElement(ClubRemovalEmail, {
      firstName: params.firstName ?? null,
      orgName: params.orgName,
      freeUntil,
      billingUrl: `${SITE_URL}/coach/paywall`,
      siteUrl: SITE_URL,
      copyOverrides,
    });
    const html = await render(element);
    const text = await render(element, { plainText: true });
    await enqueue({
      to: params.to,
      subject: clubRemovalSubject({ orgName: params.orgName }, copyOverrides),
      html,
      text,
      label: "club-removal",
    });
  } catch (e) {
    console.error("[club-emails] removal render/send failed", e);
  }
}
