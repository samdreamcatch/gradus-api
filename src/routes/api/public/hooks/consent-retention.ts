// Provisional-account retention sweep — called by pg_cron daily (PRD §6.13
// A9, §12 #25: three months). Deletes 13–17 self-sign-ups nobody claimed,
// row and auth user. Same auth as the other hooks: the service role key.

import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { inBackground } from "@/lib/background";
import { cronKeyMatches } from "@/lib/cron-auth";
import { sweepProvisionalAthletes } from "@/lib/guardian-verification.server";

export const Route = createFileRoute("/api/public/hooks/consent-retention")({
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

        await inBackground("consent-retention:sweep", async () => {
          const result = await sweepProvisionalAthletes(admin as never);
          console.log("[api] consent-retention", JSON.stringify(result));
        });
        return Response.json({ ok: true, accepted: true }, { status: 202 });
      },
    },
  },
});
