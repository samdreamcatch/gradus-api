/**
 * Server-only sender for Family plan guardian invites. Best-effort: logs and
 * swallows errors so a failed send can never break the invite itself.
 */
import * as React from "react";
import { render } from "@react-email/render";
import { FamilyInviteEmail, familyInviteSubject } from "./email-templates/family-invite";
import { fetchOverridesFor } from "./email-templates/overrides.server";
import { buildAppEmailPayload } from "./email-queue-payload";

const SITE_NAME = "gradustraining";
const SENDER_DOMAIN = "support.gradussports.com";
const FROM_DOMAIN = "gradussports.com";
export const SITE_URL = "https://gradus.training";

export function familyClaimUrl(token: string): string {
  return `${SITE_URL}/family/${token}`;
}

export async function sendFamilyInvite(params: {
  to: string;
  athleteName: string;
  inviterName: string;
  token: string;
  code: string;
}): Promise<void> {
  const label = "family-invite";
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const copyOverrides = await fetchOverridesFor(label);
    const element = React.createElement(FamilyInviteEmail, {
      athleteName: params.athleteName,
      inviterName: params.inviterName,
      claimUrl: familyClaimUrl(params.token),
      code: params.code,
      siteUrl: SITE_URL,
      copyOverrides,
    });
    const html = await render(element);
    const text = await render(element, { plainText: true });
    const subject = familyInviteSubject(
      { athleteName: params.athleteName, inviterName: params.inviterName },
      copyOverrides,
    );

    const messageId = `${label}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const { error: pendingError } = await supabaseAdmin.from("email_send_log").insert({
      message_id: messageId,
      template_name: label,
      recipient_email: params.to,
      status: "pending",
    });
    if (pendingError) {
      console.error("[family-emails] pending log failed", pendingError);
      return;
    }

    const payload = buildAppEmailPayload({
      messageId,
      to: params.to,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      senderDomain: SENDER_DOMAIN,
      subject,
      html,
      text,
      label,
      idempotencyKey: messageId,
    });

    const { error } = await supabaseAdmin.rpc("enqueue_email", {
      queue_name: "transactional_emails",
      payload,
    });

    if (error) {
      console.error("[family-emails] enqueue failed", error);
      await supabaseAdmin.from("email_send_log").insert({
        message_id: messageId,
        template_name: label,
        recipient_email: params.to,
        status: "failed",
        error_message: error.message,
      });
      return;
    }

    const { enqueueCopies } = await import("./email-templates/delivery.server");
    await enqueueCopies(supabaseAdmin as any, {
      templateName: label,
      queueName: "transactional_emails",
      payload,
    });
  } catch (err) {
    console.error("[family-emails] send failed", err);
  }
}
