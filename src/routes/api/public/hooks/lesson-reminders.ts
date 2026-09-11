// Lesson reminders — called by pg_cron every 5 minutes.
//
// Finds recurring lesson-slot occurrences starting 55-65 minutes out (in
// America/New_York — see the "Known limitations" note in this milestone's
// PR body) and, for anything not already recorded in
// `lesson_reminders_sent`, computes and logs the push payload that WOULD go
// to the coach and to the parent/athlete. This v1 does not call APNs; it
// only computes and dedupes, so a future real sender has a table it can
// trust ("row present" = "already handled").

import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { computeLessonReminders } from "@/lib/lesson-reminders.server";

export const Route = createFileRoute("/api/public/hooks/lesson-reminders")({
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

        try {
          const { scanned, wouldSend } = await computeLessonReminders({ admin });
          return Response.json({ ok: true, scanned, wouldSend });
        } catch (error) {
          console.error("[api] lesson-reminders failed", error);
          const message = error instanceof Error ? error.message : "unknown error";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
