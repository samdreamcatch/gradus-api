// Knowledge ingest — called by pg_cron every minute (PRD §6.7 "Grounded
// Ask Gradus", milestone L4).
//
// Advances queued knowledge sources through extraction, chunking and
// embedding inside a time budget (src/lib/knowledge-ingest.server.ts) and
// returns quickly when nothing is queued. Same authorization as the other
// hooks: the caller presents the service role key (from the vault, in the
// cron job) in `apikey`; the publishable key is not a credential.

import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { cronKeyMatches } from "@/lib/cron-auth";
import { runKnowledgeIngest } from "@/lib/knowledge-ingest.server";

export const Route = createFileRoute("/api/public/hooks/knowledge-ingest")({
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
          const report = await runKnowledgeIngest({ admin, env: process.env }, { maxMs: 20_000 });
          return Response.json({ ok: true, ...report });
        } catch (error) {
          console.error("[api] knowledge-ingest failed", error);
          const message = error instanceof Error ? error.message : "unknown error";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
