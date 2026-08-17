// CC / BCC fan-out for every outgoing email.
//
// The send API accepts a single `to` address, so a CC/BCC is delivered as an
// additional queued copy of the same rendered email. BCC copies are invisible
// to the primary recipient either way; CC copies arrive as their own message.

import { GLOBAL_DELIVERY_TEMPLATE, parseAddressList } from "./copy-schema";
import { buildAppEmailPayload } from "../email-queue-payload";

type AnyClient = {
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: unknown }>;
};

/** Extra addresses (template CC/BCC + global CC/BCC) for one template. */
export async function resolveExtraRecipients(
  supabase: AnyClient,
  templateName: string,
): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from("email_template_overrides")
      .select("slot_key, value")
      .in("template_name", [templateName, GLOBAL_DELIVERY_TEMPLATE])
      .in("slot_key", ["cc", "bcc"]);
    if (error) {
      console.error("[email-delivery] failed to load cc/bcc", error);
      return [];
    }
    const out = new Set<string>();
    for (const row of (data ?? []) as Array<{ value: string }>) {
      for (const address of parseAddressList(row.value)) out.add(address);
    }
    return Array.from(out);
  } catch (err) {
    console.error("[email-delivery] cc/bcc lookup crashed", err);
    return [];
  }
}

/**
 * Enqueue a copy of an already-rendered email to every configured CC/BCC
 * address. Never throws — a copy failing must not break the primary send.
 */
export async function enqueueCopies(
  supabase: AnyClient,
  opts: {
    templateName: string;
    queueName: string;
    payload: Record<string, any>;
  },
): Promise<void> {
  const primary = String(opts.payload["to"] ?? "").toLowerCase();
  const extras = (await resolveExtraRecipients(supabase, opts.templateName)).filter(
    (a) => a !== primary,
  );
  if (!extras.length) return;

  for (const to of extras) {
    const messageId = crypto.randomUUID();
    try {
      await supabase.from("email_send_log").insert({
        message_id: messageId,
        template_name: opts.templateName,
        recipient_email: to,
        status: "pending",
      });

      const payload = buildAppEmailPayload({
        messageId,
        to,
        from: String(opts.payload["from"] ?? ""),
        senderDomain: String(opts.payload["sender_domain"] ?? ""),
        subject: String(opts.payload["subject"] ?? ""),
        html: String(opts.payload["html"] ?? ""),
        text: String(opts.payload["text"] ?? ""),
        label: `${opts.payload["label"] ?? opts.templateName}-copy`,
        idempotencyKey: `${opts.payload["idempotency_key"] ?? opts.payload["message_id"] ?? messageId}-copy-${to}`,
        unsubscribeToken:
          typeof opts.payload["unsubscribe_token"] === "string"
            ? opts.payload["unsubscribe_token"]
            : undefined,
      });
      const { error } = await supabase.rpc("enqueue_email", {
        // Copies are app emails even when the source was an auth email. They
        // use their own idempotency key rather than reusing the auth run.
        queue_name: "transactional_emails",
        payload,
      });
      if (error) console.error("[email-delivery] copy enqueue failed", error);
    } catch (err) {
      console.error("[email-delivery] copy enqueue crashed", err);
    }
  }
}
