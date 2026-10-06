// Retention sweeps — called by pg_cron daily (PRD §6.13 A9). Provisional
// accounts nobody claimed in three months (§12 #25); minor accounts dormant
// for three years, after a 30-day notice; audit records past five years and
// email delivery records past thirteen months (decisions #41–#43). Same auth as
// the other hooks: the service role key.

import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { inBackground } from "@/lib/background";
import { cronKeyMatches } from "@/lib/cron-auth";
import { sweepProvisionalAthletes } from "@/lib/guardian-verification.server";
import {
  purgeEmailSendLog,
  purgeExpiredRecords,
  sweepDormantMinorAthletes,
} from "@/lib/retention.server";

/** Under the host's 30 s cap on post-response work, with headroom for the last row. */
const RUN_BUDGET_MS = 25_000;

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
          // Cheapest first, so a host that caps post-response work still runs
          // them, and the dormant sweep gets only what is left of the budget.
          const started = Date.now();
          const records = await purgeExpiredRecords(admin as never);
          console.log("[api] consent-retention records", JSON.stringify(records));
          const emailLog = await purgeEmailSendLog(admin as never, { budgetMs: 4_000 });
          console.log("[api] consent-retention email-log", JSON.stringify(emailLog));
          const provisional = await sweepProvisionalAthletes(admin as never);
          console.log("[api] consent-retention provisional", JSON.stringify(provisional));
          const dormant = await sweepDormantMinorAthletes(admin as never, {
            budgetMs: Math.max(2_000, RUN_BUDGET_MS - (Date.now() - started)),
          });
          console.log("[api] consent-retention dormant", JSON.stringify(dormant));
        });
        return Response.json({ ok: true, accepted: true }, { status: 202 });
      },
    },
  },
});
