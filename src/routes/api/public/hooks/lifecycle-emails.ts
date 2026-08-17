// Lifecycle email worker — called by pg_cron.
//
// Database triggers enqueue rows into public.lifecycle_email_jobs (one row per
// person per email kind, enforced by a unique constraint). This worker picks up
// pending jobs, resolves each person's role, name and email, renders the right
// template with any admin copy overrides applied, and hands it to the shared
// email queue (same retries, suppression and logging as every other app email).

import * as React from "react";
import { render } from "@react-email/render";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { WelcomeEmail, welcomeSubject } from "@/lib/email-templates/welcome";
import {
  ActivationEmail,
  activationSubject,
  type ActivationRole,
} from "@/lib/email-templates/activation";

const SITE_NAME = "gradustraining";
const SENDER_DOMAIN = "support.gradussports.com";
const FROM_DOMAIN = "gradussports.com";
const SITE_URL = "https://gradus.training";
const BATCH_SIZE = 50;

const SETTINGS_PATH: Record<ActivationRole, string> = {
  coach: "/coach/settings",
  parent: "/parent/settings",
  athlete: "/athlete/settings",
};

interface Person {
  role: ActivationRole;
  firstName: string | null;
  email: string | null;
}

async function resolvePerson(admin: SupabaseClient, userId: string): Promise<Person | null> {
  const [coach, parent, athlete] = await Promise.all([
    admin.from("coach_profiles").select("first_name, is_test").eq("user_id", userId).maybeSingle(),
    admin.from("parent_profiles").select("first_name, is_test").eq("user_id", userId).maybeSingle(),
    admin.from("athletes").select("first_name, is_test").eq("user_id", userId).maybeSingle(),
  ]);

  let role: ActivationRole | null = null;
  let firstName: string | null = null;
  let isTest = false;

  if (coach.data) {
    role = "coach";
    firstName = coach.data.first_name as string;
    isTest = Boolean(coach.data.is_test);
  } else if (parent.data) {
    role = "parent";
    firstName = parent.data.first_name as string;
    isTest = Boolean(parent.data.is_test);
  } else if (athlete.data) {
    role = "athlete";
    firstName = athlete.data.first_name as string;
    isTest = Boolean(athlete.data.is_test);
  }

  if (!role || isTest) return null;

  const { data: userRes } = await admin.auth.admin.getUserById(userId);
  const email = userRes?.user?.email ?? null;
  if (!email) return null;

  return { role, firstName, email };
}

async function fetchOverrides(
  admin: SupabaseClient,
  templateName: string,
): Promise<Record<string, string>> {
  const { data } = await admin
    .from("email_template_overrides")
    .select("slot_key, value")
    .eq("template_name", templateName);
  const out: Record<string, string> = {};
  for (const row of data ?? []) out[row.slot_key as string] = row.value as string;
  return out;
}

export const Route = createFileRoute("/api/public/hooks/lifecycle-emails")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl = process.env.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL;
        const publishable =
          process.env.SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !serviceKey || !publishable) {
          return Response.json({ error: "server misconfigured" }, { status: 500 });
        }

        const apikey =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        if (apikey !== publishable) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }

        const admin = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: jobs, error } = await admin
          .from("lifecycle_email_jobs")
          .select("id, user_id, kind, attempts")
          .eq("status", "pending")
          .lt("attempts", 5)
          .order("created_at", { ascending: true })
          .limit(BATCH_SIZE);

        if (error) {
          console.error("[lifecycle-emails] query failed", error);
          return Response.json({ error: error.message }, { status: 500 });
        }
        if (!jobs || jobs.length === 0) {
          return Response.json({ ok: true, processed: 0 });
        }

        const overrides: Record<string, Record<string, string>> = {
          welcome: await fetchOverrides(admin, "welcome"),
          activation: await fetchOverrides(admin, "activation"),
        };

        let sent = 0;
        let skipped = 0;

        for (const job of jobs) {
          const kind = job.kind as "welcome" | "activation";
          const person = await resolvePerson(admin, job.user_id as string);

          if (!person) {
            await admin
              .from("lifecycle_email_jobs")
              .update({ status: "skipped", last_error: "no eligible recipient" })
              .eq("id", job.id);
            skipped += 1;
            continue;
          }

          const settingsUrl = `${SITE_URL}${SETTINGS_PATH[person.role]}`;
          const copyOverrides = overrides[kind];

          const element =
            kind === "welcome"
              ? React.createElement(WelcomeEmail, {
                  firstName: person.firstName,
                  settingsUrl,
                  siteUrl: SITE_URL,
                  copyOverrides,
                })
              : React.createElement(ActivationEmail, {
                  role: person.role,
                  firstName: person.firstName,
                  settingsUrl,
                  siteUrl: SITE_URL,
                  copyOverrides,
                });

          const subject =
            kind === "welcome"
              ? welcomeSubject({}, copyOverrides)
              : activationSubject({ role: person.role }, copyOverrides);

          const html = await render(element);
          const text = await render(element, { plainText: true });

          const messageId = `${kind}-${job.id}`;

          await admin.from("email_send_log").insert({
            message_id: messageId,
            template_name: kind,
            recipient_email: person.email,
            status: "pending",
          });

          const { error: enqueueError } = await admin.rpc("enqueue_email", {
            queue_name: "transactional_emails",
            payload: {
              run_id: messageId,
              message_id: messageId,
              to: person.email,
              from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
              sender_domain: SENDER_DOMAIN,
              subject,
              html,
              text,
              purpose: "transactional",
              label: kind,
              queued_at: new Date().toISOString(),
            },
          });

          if (enqueueError) {
            console.error("[lifecycle-emails] enqueue failed", enqueueError);
            await admin
              .from("lifecycle_email_jobs")
              .update({
                attempts: (job.attempts as number) + 1,
                last_error: enqueueError.message,
                status: (job.attempts as number) + 1 >= 5 ? "failed" : "pending",
              })
              .eq("id", job.id);
            await admin.from("email_send_log").insert({
              message_id: messageId,
              template_name: kind,
              recipient_email: person.email,
              status: "failed",
              error_message: "Failed to enqueue lifecycle email",
            });
            continue;
          }

          const { enqueueCopies } = await import("@/lib/email-templates/delivery.server");
          await enqueueCopies(admin as any, {
            templateName: kind,
            queueName: "transactional_emails",
            payload: {
              message_id: messageId,
              to: person.email,
              from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
              sender_domain: SENDER_DOMAIN,
              subject,
              html,
              text,
              purpose: "transactional",
              label: kind,
            },
          });

          await admin
            .from("lifecycle_email_jobs")
            .update({
              status: "sent",
              sent_at: new Date().toISOString(),
              attempts: (job.attempts as number) + 1,
            })
            .eq("id", job.id);
          sent += 1;
        }

        return Response.json({ ok: true, processed: jobs.length, sent, skipped });
      },
    },
  },
});
