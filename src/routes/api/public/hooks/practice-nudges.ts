// Practice nudges — called by pg_cron every 15 minutes.
//
// Three days after an athlete's lesson (America/New_York, like lesson
// reminders), with no practice logged and no lesson since, records the
// lesson in `practice_nudges_sent` and pushes the athlete and guardians.
// Same auth as the other hooks: the service role key in `apikey`.

import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { computePracticeNudges } from "@/lib/practice-nudges.server";
import { cronKeyMatches } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/hooks/practice-nudges")({
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
          const result = await computePracticeNudges({ admin });
          return Response.json({ ok: true, ...result });
        } catch (error) {
          console.error("[api] practice-nudges failed", error);
          const message = error instanceof Error ? error.message : "unknown error";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
