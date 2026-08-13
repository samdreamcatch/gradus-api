import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";

async function assertAdmin(context: { userId: string; supabase: any }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
}

export type EmailLogRow = {
  id: string;
  messageId: string | null;
  templateName: string;
  recipientEmail: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  attempts: number;
};

const inputSchema = z.object({
  /** ISO timestamp — inclusive lower bound on created_at. */
  start: z.string(),
  /** ISO timestamp — inclusive upper bound on created_at. */
  end: z.string(),
  template: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
});

/**
 * Deliverability snapshot for /admin/email-health.
 *
 * `email_send_log` is append-only and writes one row per state transition
 * (pending → sent | dlq | …), all sharing a `message_id`. Every count and
 * every table row here is deduplicated down to the latest row per
 * `message_id` so one email is one entry.
 */
export const getEmailHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows, error } = await supabaseAdmin
      .from("email_send_log")
      .select("id, message_id, template_name, recipient_email, status, error_message, created_at")
      .gte("created_at", data.start)
      .lte("created_at", data.end)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) dbError(error);

    // Latest row per message_id wins; rows without a message_id stand alone.
    const latest = new Map<string, EmailLogRow>();
    for (const r of (rows ?? []) as Array<{
      id: string;
      message_id: string | null;
      template_name: string;
      recipient_email: string;
      status: string;
      error_message: string | null;
      created_at: string;
    }>) {
      const key = r.message_id ?? `id:${r.id}`;
      const existing = latest.get(key);
      if (existing) {
        existing.attempts += 1;
        continue;
      }
      latest.set(key, {
        id: r.id,
        messageId: r.message_id,
        templateName: r.template_name,
        recipientEmail: r.recipient_email,
        status: r.status,
        errorMessage: r.error_message,
        createdAt: r.created_at,
        attempts: 1,
      });
    }

    const all = [...latest.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    // Filter options come from the whole window, not the filtered slice, so
    // the dropdowns don't collapse as you narrow things down.
    const templates = [...new Set(all.map((r) => r.templateName))].sort();

    const filtered = all.filter(
      (r) =>
        (!data.template || r.templateName === data.template) &&
        (!data.status || r.status === data.status),
    );

    const counts = { total: filtered.length, sent: 0, failed: 0, suppressed: 0, pending: 0 };
    for (const r of filtered) {
      if (r.status === "sent") counts.sent += 1;
      else if (r.status === "dlq" || r.status === "failed" || r.status === "bounced")
        counts.failed += 1;
      else if (r.status === "suppressed" || r.status === "complained") counts.suppressed += 1;
      else if (r.status === "pending") counts.pending += 1;
    }

    const { data: suppressed, error: supErr } = await supabaseAdmin
      .from("suppressed_emails")
      .select("id, email, reason, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (supErr) dbError(supErr);

    return {
      counts,
      templates,
      rows: filtered.slice(0, 500),
      truncated: filtered.length > 500,
      suppressed: (suppressed ?? []) as Array<{
        id: string;
        email: string;
        reason: string;
        created_at: string;
      }>,
    };
  });
