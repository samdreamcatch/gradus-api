// Competition recap prompts — called by pg_cron once a day (mid-morning
// America/New_York).
//
// Pushes everyone who viewed a board for a competition that ended yesterday
// and has neither dismissed nor written a recap, once per (user,
// competition), recorded in `competition_recap_prompts_sent`. Same auth as
// the other hooks: the service role key in `apikey`.

import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { computeCompetitionRecapPrompts } from "@/lib/competition-recap-prompts.server";
import { cronKeyMatches } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/hooks/competition-recaps")({
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
          const result = await computeCompetitionRecapPrompts({ admin });
          return Response.json({ ok: true, ...result });
        } catch (error) {
          console.error("[api] competition-recaps failed", error);
          const message = error instanceof Error ? error.message : "unknown error";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
