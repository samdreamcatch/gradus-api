import { createFileRoute } from "@tanstack/react-router";

/**
 * Keeps live boards warm even when nobody is polling. Called by a scheduler.
 * Guarded by a shared secret header — this path bypasses site auth.
 */
export const Route = createFileRoute("/api/public/board/refresh")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["BOARD_REFRESH_SECRET"];
        if (!secret || request.headers.get("x-board-secret") !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }

        const mod = await import("@/integrations/supabase/client.server");
        const db = mod.supabaseAdmin as unknown as { from: (t: string) => any };
        const { refreshCompetition } = await import("@/lib/board-refresh.server");

        const today = new Date().toISOString().slice(0, 10);
        const comps = await db
          .from("competitions")
          .select("id, ijs_base_url, year, starts_on, ends_on, active")
          .eq("active", true);

        const live = ((comps.data ?? []) as any[]).filter(
          (c) => (!c.starts_on || c.starts_on <= today) && (!c.ends_on || c.ends_on >= today),
        );

        let refreshed = 0;
        for (const c of live) {
          const payload = await refreshCompetition({
            id: c.id,
            ijs_base_url: c.ijs_base_url,
            year: c.year,
          });
          if (payload) refreshed += 1;
        }

        return Response.json({ competitions: live.length, refreshed });
      },
    },
  },
});
