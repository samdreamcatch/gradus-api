// App Review demo activity — called by pg_cron once a day.
//
// Moves the default demo athlete's practice sessions and messages back into
// the last two weeks (`refreshDemoActivity`), so the demo coach's pre-lesson
// briefing never goes blank. Test rows only; does nothing when the demo
// accounts haven't been created.

import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { runDemoActivityRefresh } from "@/lib/demo-activity.server";
import { cronKeyMatches } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/hooks/demo-activity")({
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
          const result = await runDemoActivityRefresh({ admin });
          return Response.json({ ok: true, ...result });
        } catch (error) {
          console.error("[api] demo-activity failed", error);
          const message = error instanceof Error ? error.message : "unknown error";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
