// Trial-ending reminders — called by pg_cron once a day.
//
// Scans coaches who are mid-trial on Stripe with a trial end date roughly
// three days out and sends the "trial ending" billing notice. Sends are
// de-duplicated by message id (coach + trial end date), so re-running the
// cron never double-sends.

import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { formatEventDate, planLabelFor, sendBillingNotice } from "@/lib/billing-emails.server";

const DAY_MS = 24 * 60 * 60 * 1000;

export const Route = createFileRoute("/api/public/hooks/billing-notices")({
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

        const now = Date.now();
        const windowStart = new Date(now + 2 * DAY_MS).toISOString();
        const windowEnd = new Date(now + 3 * DAY_MS).toISOString();

        const { data: coaches, error } = await admin
          .from("coach_profiles")
          .select("user_id, subscription_tier, trial_ends_at, is_test")
          .eq("subscription_status", "trialing")
          .gte("trial_ends_at", windowStart)
          .lte("trial_ends_at", windowEnd)
          .limit(200);

        if (error) {
          console.error("[billing-notices] query failed", error);
          return Response.json({ error: error.message }, { status: 500 });
        }

        let sent = 0;
        for (const coach of coaches ?? []) {
          if (coach.is_test) continue;
          const trialEnd = coach.trial_ends_at as string;
          const messageId = await sendBillingNotice(admin, {
            userId: coach.user_id as string,
            kind: "trial_ending",
            eventDate: formatEventDate(trialEnd),
            planLabel: planLabelFor(coach.subscription_tier as string | null),
            dedupeKey: `${coach.user_id}-${trialEnd.slice(0, 10)}`,
          });
          if (messageId) sent += 1;
        }

        return Response.json({ ok: true, scanned: coaches?.length ?? 0, sent });
      },
    },
  },
});
