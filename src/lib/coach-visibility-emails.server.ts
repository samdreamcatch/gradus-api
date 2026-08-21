/**
 * Server-only sender for coach visibility requests (Team plan). Best-effort:
 * logs and swallows errors so a failed send can never break the toggle itself.
 */
import * as React from "react";
import { render } from "@react-email/render";
import { CoachVisibilityEmail, coachVisibilitySubject } from "./email-templates/coach-visibility";
import { fetchOverridesFor } from "./email-templates/overrides.server";
import { buildAppEmailPayload } from "./email-queue-payload";

const SITE_NAME = "gradustraining";
const SENDER_DOMAIN = "support.gradussports.com";
const FROM_DOMAIN = "gradussports.com";
export const SITE_URL = "https://gradus.training";

export async function sendCoachVisibilityRequest(params: {
  to: string;
  coachName: string;
  otherCoachName: string;
  athleteName: string;
  parentName: string;
}): Promise<void> {
  const label = "coach-visibility";
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const copyOverrides = await fetchOverridesFor(label);
    const actionUrl = `${SITE_URL}/coach/settings`;
    const element = React.createElement(CoachVisibilityEmail, {
      coachName: params.coachName,
      otherCoachName: params.otherCoachName,
      athleteName: params.athleteName,
      parentName: params.parentName,
      actionUrl,
      siteUrl: SITE_URL,
      copyOverrides,
    });
    const html = await render(element);
    const text = await render(element, { plainText: true });
    const subject = coachVisibilitySubject(
      { otherCoachName: params.otherCoachName, athleteName: params.athleteName },
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
      console.error("[coach-visibility-emails] pending log failed", pendingError);
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
      console.error("[coach-visibility-emails] enqueue failed", error);
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
    console.error("[coach-visibility-emails] send failed", err);
  }
}
