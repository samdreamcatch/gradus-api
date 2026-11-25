import { siteUrl } from "@/lib/site-url";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { EMAIL_COPY_SCHEMA } from "./email-templates/copy-schema";
import { dbError } from "./db-error";
import { buildAppEmailPayload } from "./email-queue-payload";

/** Fixed address used by the "send a test" button in the email admin. */
export const TEST_EMAIL_ADDRESS = "support@gradussports.com";

const SITE_NAME = "Gradus Training";
const SENDER_DOMAIN = "support.gradussports.com";
const FROM_DOMAIN = "gradussports.com";
const SITE_URL = siteUrl();

async function assertAdmin(context: { userId: string; supabase: any }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
}

/** Search app users by email so an admin can pick a real recipient. */
export const searchEmailRecipients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ query: z.string().min(2) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const q = data.query.trim().toLowerCase();

    const { data: page, error } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (error) throw new Error(error.message);

    return (page?.users ?? [])
      .filter((u) => (u.email ?? "").toLowerCase().includes(q))
      .slice(0, 20)
      .map((u) => ({ id: u.id, email: u.email ?? "" }));
  });

/** Manually push one template to an email address (real user or a test send). */
export const sendEmailManually = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string(),
        recipientEmail: z.string().email(),
        role: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const schema = EMAIL_COPY_SCHEMA[data.name];
    if (!schema) throw new Error("Unknown template");
    if (schema.noPreview) throw new Error("This entry has no email body to send");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { renderTemplateForSend } = await import("./email-templates/render.server");
    const { resolveRecipientPersonalization } =
      await import("./email-templates/personalize.server");

    const { data: overrideRows, error: overrideError } = await supabaseAdmin
      .from("email_template_overrides")
      .select("slot_key, value")
      .eq("template_name", data.name);
    if (overrideError) dbError(overrideError);
    const overrides: Record<string, string> = {};
    for (const row of overrideRows ?? []) {
      overrides[row.slot_key as string] = row.value as string;
    }

    // Real recipient data wins over the admin's role selector and the
    // template's sample props, so the delivered email is personalized.
    const person = await resolveRecipientPersonalization(supabaseAdmin, data.recipientEmail);
    const role = person.role ?? data.role;
    const extraProps: Record<string, any> = { siteUrl: SITE_URL };
    if (role) {
      extraProps["settingsUrl"] = `${SITE_URL}/${role}/settings`;
      extraProps["role"] = role;
    }
    if (person.firstName) {
      extraProps["firstName"] = person.firstName;
      extraProps["name"] = person.firstName;
    }
    if (person.email) extraProps["recipient"] = person.email;

    const { html, text, subject } = await renderTemplateForSend(
      data.name,
      overrides,
      role,
      extraProps,
    );

    const messageId = crypto.randomUUID();
    const recipient = data.recipientEmail.trim();

    const { error: pendingError } = await supabaseAdmin.from("email_send_log").insert({
      message_id: messageId,
      template_name: `manual-${data.name}`,
      recipient_email: recipient,
      status: "pending",
    });
    if (pendingError) dbError(pendingError);

    const payload = buildAppEmailPayload({
      messageId,
      to: recipient,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      senderDomain: SENDER_DOMAIN,
      subject,
      html,
      text,
      label: `manual-${data.name}`,
      idempotencyKey: `manual-${data.name}-${messageId}`,
    });

    const { error: enqueueError } = await supabaseAdmin.rpc("enqueue_email", {
      queue_name: "transactional_emails",
      payload,
    });

    if (enqueueError) {
      await supabaseAdmin.from("email_send_log").insert({
        message_id: messageId,
        template_name: data.name,
        recipient_email: recipient,
        status: "failed",
        error_message: "Failed to enqueue manual email",
      });
      throw new Error(enqueueError.message);
    }

    const { enqueueCopies } = await import("./email-templates/delivery.server");
    await enqueueCopies(supabaseAdmin as any, {
      templateName: data.name,
      queueName: "transactional_emails",
      payload,
    });

    return {
      ok: true,
      recipient,
      subject,
      personalized: Boolean(person.firstName || person.role),
      firstName: person.firstName,
      role: person.role,
    };
  });

/** Preview a template exactly as one real recipient would receive it. */
export const previewEmailForRecipient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string(),
        recipientEmail: z.string().email(),
        overrides: z.record(z.string(), z.string()).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const schema = EMAIL_COPY_SCHEMA[data.name];
    if (!schema) throw new Error("Unknown template");
    if (schema.noPreview) throw new Error("This entry has no email body");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { renderTemplateForSend } = await import("./email-templates/render.server");
    const { resolveRecipientPersonalization } =
      await import("./email-templates/personalize.server");

    let overrides: Record<string, string> = data.overrides ?? {};
    if (!data.overrides) {
      const { data: rows, error } = await supabaseAdmin
        .from("email_template_overrides")
        .select("slot_key, value")
        .eq("template_name", data.name);
      if (error) dbError(error);
      overrides = {};
      for (const row of rows ?? []) overrides[row.slot_key as string] = row.value as string;
    }

    const person = await resolveRecipientPersonalization(supabaseAdmin, data.recipientEmail);
    const extraProps: Record<string, any> = { siteUrl: SITE_URL };
    if (person.role) {
      extraProps["settingsUrl"] = `${SITE_URL}/${person.role}/settings`;
      extraProps["role"] = person.role;
    }
    if (person.firstName) {
      extraProps["firstName"] = person.firstName;
      extraProps["name"] = person.firstName;
    }
    extraProps["recipient"] = person.email;

    const { html, subject } = await renderTemplateForSend(
      data.name,
      overrides,
      person.role ?? undefined,
      extraProps,
    );

    return {
      html,
      subject,
      role: person.role,
      firstName: person.firstName,
      found: Boolean(person.userId),
    };
  });
