// Lesson reminders — called by pg_cron every 5 minutes.
//
// Finds recurring lesson-slot occurrences starting 10-15 minutes out (in
// America/New_York) and, for anything not already recorded in
// `lesson_reminders_sent`, pushes the coach an "up next" nudge through
// `notifyUsers` (APNs). The table stays the dedupe boundary: "row present" =
// "already handled".

import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { computeLessonReminders } from "@/lib/lesson-reminders.server";
import { cronKeyMatches } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/hooks/lesson-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl = process.env.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !serviceKey) {
          return Response.json({ error: "server misconfigured" }, { status: 500 });
        }

        const apikey =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        if (!cronKeyMatches(apikey, serviceKey)) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }

        const admin = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        try {
          const { scanned, wouldSend, sent } = await computeLessonReminders({ admin });
          return Response.json({ ok: true, scanned, wouldSend, sent });
        } catch (error) {
          console.error("[api] lesson-reminders failed", error);
          const message = error instanceof Error ? error.message : "unknown error";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
