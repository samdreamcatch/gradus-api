// Billing lifecycle emails (trial ending, payment failed, plan canceled).
//
// Server-only. Renders the shared `billing-notice` template with any admin
// copy overrides applied and hands it to the same transactional email queue
// every other app email uses, so retries, suppression and logging behave
// identically.

import * as React from "react";
import { render } from "@react-email/render";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BillingNoticeEmail,
  billingNoticeSubject,
  type BillingNoticeKind,
} from "@/lib/email-templates/billing-notice";
import { buildAppEmailPayload } from "@/lib/email-queue-payload";

const SITE_NAME = "Gradus Training";
const SENDER_DOMAIN = "support.gradussports.com";
const FROM_DOMAIN = "gradussports.com";
const SITE_URL = "https://gradus.training";
const TEMPLATE = "billing-notice";

export function planLabelFor(tier: string | null | undefined): string {
  if (tier === "coach_pro") return "Coach Pro";
  if (tier === "coach") return "Coach";
  return "your Gradus plan";
}

export function formatEventDate(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const date =
    typeof value === "number" ? new Date(value * 1000) : new Date(value as string | Date);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

/**
 * Send one billing notice to a coach. Returns the message id on success,
 * or null when there is nothing to send (test account, no email, suppressed
 * upstream). Never throws — billing webhooks must still return 200.
 */
export async function sendBillingNotice(
  admin: SupabaseClient<any>,
  args: {
    userId: string;
    kind: BillingNoticeKind;
    eventDate?: string;
    planLabel?: string;
    /** Stable per-event id so duplicate webhook deliveries don't double-send. */
    dedupeKey: string;
  },
): Promise<string | null> {
  try {
    const { data: coach } = await admin
      .from("coach_profiles")
      .select("first_name, is_test")
      .eq("user_id", args.userId)
      .maybeSingle();
    if (!coach || coach.is_test) return null;

    const { data: userRes } = await admin.auth.admin.getUserById(args.userId);
    const email = userRes?.user?.email;
    if (!email) return null;

    const { data: overrideRows } = await admin
      .from("email_template_overrides")
      .select("slot_key, value")
      .eq("template_name", TEMPLATE);
    const copyOverrides: Record<string, string> = {};
    for (const row of overrideRows ?? []) {
      copyOverrides[row.slot_key as string] = row.value as string;
    }

    const messageId = `billing-${args.kind}-${args.dedupeKey}`.slice(0, 120);

    // Idempotency: one send per (kind, stripe event / period).
    const { data: already } = await admin
      .from("email_send_log")
      .select("id")
      .eq("message_id", messageId)
      .limit(1);
    if (already && already.length > 0) return null;

    const props = {
      kind: args.kind,
      firstName: (coach.first_name as string) ?? null,
      eventDate: args.eventDate ?? "",
      planLabel: args.planLabel ?? "your Gradus plan",
      billingUrl: `${SITE_URL}/coach/settings`,
      siteUrl: SITE_URL,
      copyOverrides,
    };

    const element = React.createElement(BillingNoticeEmail, props);
    const subject = billingNoticeSubject(
      { kind: args.kind, firstName: props.firstName, planLabel: props.planLabel },
      copyOverrides,
    );
    const html = await render(element);
    const text = await render(element, { plainText: true });

    await admin.from("email_send_log").insert({
      message_id: messageId,
      template_name: TEMPLATE,
      recipient_email: email,
      status: "pending",
      metadata: { kind: args.kind },
    });

    const payload = buildAppEmailPayload({
      messageId,
      to: email,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      senderDomain: SENDER_DOMAIN,
      subject,
      html,
      text,
      label: TEMPLATE,
      idempotencyKey: messageId,
    });

    const { error } = await admin.rpc("enqueue_email", {
      queue_name: "transactional_emails",
      payload,
    });
    if (error) {
      await admin.from("email_send_log").insert({
        message_id: messageId,
        template_name: TEMPLATE,
        recipient_email: email,
        status: "failed",
        error_message: error.message,
      });
      return null;
    }

    const { enqueueCopies } = await import("@/lib/email-templates/delivery.server");
    await enqueueCopies(admin as any, {
      templateName: TEMPLATE,
      queueName: "transactional_emails",
      payload,
    });

    return messageId;
  } catch (e) {
    console.error("[billing-emails] send failed", e);
    return null;
  }
}
