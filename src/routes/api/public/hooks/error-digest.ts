// Hourly error digest — queried by pg_cron.
// Reads production-environment client_errors from the last hour, groups by
// normalized message signature, renders the digest template, and enqueues
// ONE email to the admin recipient(s). If there are no new errors in the
// window, nothing is sent.

import * as React from "react";
import { render } from "@react-email/render";
import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "node:crypto";
import { ErrorDigestEmail, type DigestGroup } from "@/lib/email-templates/error-digest";

const ALERT_RECIPIENTS = ["alyson@gradussports.com"];
const SITE_NAME = "gradustraining";
const SENDER_DOMAIN = "support.gradussports.com";
const FROM_DOMAIN = "gradussports.com";
const ROOT_DOMAIN = "gradus.training";
const WINDOW_MINUTES = 65; // 1h + small overlap so nothing slips through cron jitter

function normalizeErrorMessage(msg: string): string {
  return msg
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hex>")
    .replace(/"[^"]{1,120}"/g, '"<str>"')
    .replace(/'[^']{1,120}'/g, "'<str>'")
    .replace(/\b\d+(?:\.\d+)?\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function signatureFor(source: string, normalized: string): string {
  return createHash("sha256").update(`${source}::${normalized}`).digest("hex").slice(0, 16);
}

function formatWindow(sinceISO: string): string {
  const since = new Date(sinceISO);
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  };
  const fmt = new Intl.DateTimeFormat("en-US", opts);
  return `${fmt.format(since)} → ${fmt.format(now)} ET`;
}

export const Route = createFileRoute("/api/public/hooks/error-digest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Verify the caller — pg_cron sends the Supabase publishable/anon key.
        const supabaseUrl = process.env.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL;
        const publishable =
          process.env.SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !serviceKey || !publishable) {
          return new Response(JSON.stringify({ error: "server misconfigured" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const apikey =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        if (apikey !== publishable) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

        const { data: rows, error } = await supabaseAdmin
          .from("client_errors")
          .select(
            "id, source, message, route, user_id, user_email, user_role, user_name, created_at, environment",
          )
          .eq("environment", "production")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(2000);

        if (error) {
          console.error("[error-digest] query failed", error);
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (!rows || rows.length === 0) {
          return new Response(
            JSON.stringify({ ok: true, sent: false, reason: "no errors in window" }),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        // Group by (source, normalized message).
        const groups = new Map<
          string,
          {
            g: DigestGroup;
            users: Map<string, { label: string; role: string | null; count: number }>;
          }
        >();

        for (const r of rows) {
          const norm = normalizeErrorMessage(r.message as string);
          const key = signatureFor(r.source as string, norm);
          let entry = groups.get(key);
          if (!entry) {
            entry = {
              g: {
                message: r.message as string,
                count: 0,
                source: r.source as "client" | "server",
                lastRoute: (r.route as string | null) ?? null,
                lastOccurredAt: new Date(r.created_at as string).toLocaleString("en-US", {
                  timeZone: "America/New_York",
                }),
                users: [],
                anonCount: 0,
                sampleErrorId: r.id as string,
              },
              users: new Map(),
            };
            groups.set(key, entry);
          }
          entry.g.count += 1;

          const uid = (r.user_id as string | null) ?? null;
          if (!uid) {
            entry.g.anonCount += 1;
          } else {
            const label =
              (r.user_name as string | null) || (r.user_email as string | null) || uid.slice(0, 8);
            const existing = entry.users.get(uid);
            if (existing) {
              existing.count += 1;
            } else {
              entry.users.set(uid, {
                label,
                role: (r.user_role as string | null) ?? null,
                count: 1,
              });
            }
          }
        }

        const digestGroups: DigestGroup[] = Array.from(groups.values())
          .map((e) => ({
            ...e.g,
            users: Array.from(e.users.values()).sort((a, b) => b.count - a.count),
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 40); // cap groups per email

        const windowLabel = formatWindow(since);
        const element = React.createElement(ErrorDigestEmail, {
          windowLabel,
          totalErrors: rows.length,
          totalGroups: groups.size,
          groups: digestGroups,
          appBaseUrl: `https://${ROOT_DOMAIN}`,
        });
        const html = await render(element);
        const text = await render(element, { plainText: true });

        const subject = `[Gradus errors] ${rows.length} error${
          rows.length === 1 ? "" : "s"
        } in ${groups.size} group${groups.size === 1 ? "" : "s"} — ${windowLabel}`;

        let enqueued = 0;
        for (const to of ALERT_RECIPIENTS) {
          const messageId = `error-digest-${Date.now()}-${to}`;
          await supabaseAdmin.from("email_send_log").insert({
            message_id: messageId,
            template_name: "error-digest",
            recipient_email: to,
            status: "pending",
          });
          const { error: enqueueError } = await supabaseAdmin.rpc("enqueue_email", {
            queue_name: "transactional_emails",
            payload: {
              run_id: messageId,
              message_id: messageId,
              to,
              from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
              sender_domain: SENDER_DOMAIN,
              subject,
              html,
              text,
              purpose: "transactional",
              label: "error-digest",
              queued_at: new Date().toISOString(),
            },
          });
          if (enqueueError) {
            console.error("[error-digest] enqueue failed", enqueueError);
            await supabaseAdmin.from("email_send_log").insert({
              message_id: messageId,
              template_name: "error-digest",
              recipient_email: to,
              status: "failed",
              error_message: "Failed to enqueue digest email",
            });
          } else {
            enqueued += 1;
            // Fan out CC/BCC once, not per internal alert recipient.
            const { enqueueCopies } = await import("@/lib/email-templates/delivery.server");
            if (enqueued === 1)
              await enqueueCopies(supabaseAdmin as any, {
                templateName: "error-digest",
                queueName: "transactional_emails",
                payload: {
                  message_id: messageId,
                  to,
                  from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
                  sender_domain: SENDER_DOMAIN,
                  subject,
                  html,
                  text,
                  purpose: "transactional",
                  label: "error-digest",
                },
              });
          }
        }

        return new Response(
          JSON.stringify({
            ok: true,
            sent: true,
            recipients: enqueued,
            totalErrors: rows.length,
            totalGroups: groups.size,
            windowMinutes: WINDOW_MINUTES,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
