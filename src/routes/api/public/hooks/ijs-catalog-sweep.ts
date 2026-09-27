// IJS catalog sweep — called by pg_cron once a minute
// (migration 20260927100000_ijs_catalog). Checks up to 25 IJS competition
// pages, one at a time, and catalogs what it finds, so Live boards can be
// searched instead of set up by hand. Same auth as the other hooks: the
// service role key in `apikey`.

import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { cronKeyMatches } from "@/lib/cron-auth";
import { sweepCatalog } from "@/lib/ijs-catalog.server";

export const Route = createFileRoute("/api/public/hooks/ijs-catalog-sweep")({
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await sweepCatalog({ db: admin as any });
          return Response.json({ ok: true, ...result });
        } catch (error) {
          console.error("[api] ijs-catalog-sweep failed", error);
          const message = error instanceof Error ? error.message : "unknown error";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
