// Skill inference — called by pg_cron nightly (migration 20260922190000).
//
// Writes "likely landed" skill events for benched plans the coach did not
// answer the "why?" prompt for, and logs the rule's precision against the
// plans they did answer (PRD §6.7 item 5, milestone L3). Replies 202 and does
// the work after the response. Same auth as the other hooks: the service
// role key.

import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { inBackground } from "@/lib/background";
import { cronKeyMatches } from "@/lib/cron-auth";
import { runSkillInference } from "@/lib/skill-inference.server";

export const Route = createFileRoute("/api/public/hooks/skill-inference")({
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

        await inBackground("skill-inference:run", async () => {
          const result = await runSkillInference(admin);
          console.log("[api] skill-inference", JSON.stringify(result));
        });
        return Response.json({ ok: true, accepted: true }, { status: 202 });
      },
    },
  },
});
