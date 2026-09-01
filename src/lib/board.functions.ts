import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { BoardPayload, BoardResponse } from "./board-types";
import { DEMO_LIST_ENTRY, DEMO_SLUG, buildDemoBoard } from "./board-demo";

const slugSchema = z.object({ slug: z.string().trim().min(1).max(80) });

/**
 * Public: the current board for one competition.
 *
 * Reads the shared snapshot. When the competition is inside its published date
 * window and the snapshot is stale, one caller refreshes it and everyone else
 * is served the cache — the source is never fetched per viewer.
 */
export const getBoard = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => slugSchema.parse(input))
  .handler(async ({ data }): Promise<BoardResponse | null> => {
    // Built-in sample board: no database, no scraper.
    if (data.slug === DEMO_SLUG) return buildDemoBoard();

    const mod = await import("@/integrations/supabase/client.server");
    const db = mod.supabaseAdmin as unknown as { from: (t: string) => any };
    const { REFRESH_INTERVAL_MS, refreshCompetition } = await import("./board-refresh.server");

    const comp = await db
      .from("competitions")
      .select("id, slug, name, dates_label, location, active, starts_on, ends_on, ijs_base_url, year")
      .eq("slug", data.slug)
      .maybeSingle();
    if (!comp.data) return null;
    const c = comp.data as {
      id: string;
      slug: string;
      name: string;
      dates_label: string;
      location: string;
      active: boolean;
      starts_on: string | null;
      ends_on: string | null;
      ijs_base_url: string;
      year: number;
    };

    const snap = await db
      .from("competition_snapshots")
      .select("payload, generated_at, error")
      .eq("competition_id", c.id)
      .maybeSingle();
    const cached = (snap.data ?? null) as {
      payload: BoardPayload | null;
      generated_at: string | null;
      error: string | null;
    } | null;

    const today = new Date().toISOString().slice(0, 10);
    const isLiveWindow =
      c.active && (!c.starts_on || c.starts_on <= today) && (!c.ends_on || c.ends_on >= today);

    let payload = cached?.payload ?? null;
    let generatedAt = cached?.generated_at ?? null;
    const stale =
      !generatedAt || Date.now() - new Date(generatedAt).getTime() > REFRESH_INTERVAL_MS;

    if ((isLiveWindow && stale) || !payload) {
      const fresh = await refreshCompetition({
        id: c.id,
        ijs_base_url: c.ijs_base_url,
        year: c.year,
      });
      if (fresh) {
        payload = fresh;
        generatedAt = fresh.generatedAt;
      }
    }

    return {
      slug: c.slug,
      name: c.name,
      datesLabel: c.dates_label,
      location: c.location,
      active: c.active,
      isLiveWindow,
      generatedAt,
      error: cached?.error ?? null,
      payload,
    };
  });

/** Public: competitions with a board, newest first. */
export const listBoards = createServerFn({ method: "GET" }).handler(
  async (): Promise<
    { slug: string; name: string; datesLabel: string; location: string; isLiveWindow: boolean }[]
  > => {
    let rows: any[] = [];
    try {
      const mod = await import("@/integrations/supabase/client.server");
      const db = mod.supabaseAdmin as unknown as { from: (t: string) => any };
      const res = await db
        .from("competitions")
        .select("slug, name, dates_label, location, active, starts_on, ends_on")
        .eq("active", true)
        .order("starts_on", { ascending: false, nullsFirst: false });
      rows = (res?.data ?? []) as any[];
    } catch {
      // Table not available yet — the built-in sample board still lists.
      rows = [];
    }
    const today = new Date().toISOString().slice(0, 10);

    return [
      DEMO_LIST_ENTRY,
      ...rows.map((c) => ({
        slug: c.slug as string,
        name: c.name as string,
        datesLabel: c.dates_label as string,
        location: c.location as string,
        isLiveWindow:
          (!c.starts_on || c.starts_on <= today) && (!c.ends_on || c.ends_on >= today),
      })),
    ];
  },
);

/**
 * Signed-in extra: the names of the athletes this viewer follows, used to pin
 * their skater to the top of the board. Names only — nothing else is exposed.
 */
export const getMySkaterNames = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<string[]> => {
    const { supabase } = context;
    const { data } = await supabase.from("athletes").select("first_name, last_name");
    return (data ?? []).map((a) => `${a.first_name} ${a.last_name}`.trim());
  });
