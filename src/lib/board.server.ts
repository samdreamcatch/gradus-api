/**
 * Shared Live Board reads — the single source of truth for both the web
 * server functions (src/lib/board.functions.ts) and the /api/v1 board routes
 * (src/routes/api/v1/public/boards/*, boards/my-skaters). Per docs/ios/PRD.md
 * §6.2, business logic lives here and each transport is a thin wrapper, so web
 * and iOS cannot drift.
 *
 * The competition tables are not in the generated Supabase `Database` type,
 * so admin-client access is cast the same way the rest of the board code does.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { BoardPayload, BoardResponse } from "./board-types";
import { DEMO_LIST_ENTRY, DEMO_SLUG, buildDemoBoard } from "./board-demo";

/** One row of the board index. */
export interface BoardListEntry {
  slug: string;
  name: string;
  datesLabel: string;
  location: string;
  isLiveWindow: boolean;
}

/** Service-role client, cast loosely for the un-typed competition tables. */
type AdminDb = { from: (table: string) => any };

/**
 * The current board for one competition. Reads the shared snapshot; when the
 * competition is inside its published date window and the snapshot is stale,
 * one caller refreshes it and everyone else is served the cache — the source
 * is never fetched per viewer. Returns null when no such competition exists.
 */
export async function fetchBoard(admin: AdminDb, slug: string): Promise<BoardResponse | null> {
  // Built-in sample board: no database, no scraper.
  if (slug === DEMO_SLUG) return buildDemoBoard();

  const { REFRESH_INTERVAL_MS, refreshCompetition } = await import("./board-refresh.server");

  const comp = await admin
    .from("competitions")
    .select("id, slug, name, dates_label, location, active, starts_on, ends_on, ijs_base_url, year")
    .eq("slug", slug)
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

  const snap = await admin
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
  const stale = !generatedAt || Date.now() - new Date(generatedAt).getTime() > REFRESH_INTERVAL_MS;

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
    competitionId: c.id,
    name: c.name,
    datesLabel: c.dates_label,
    location: c.location,
    active: c.active,
    isLiveWindow,
    generatedAt,
    error: cached?.error ?? null,
    payload,
  };
}

/** Competitions with a board, newest first, always led by the sample board. */
export async function fetchBoardList(admin: AdminDb): Promise<BoardListEntry[]> {
  let rows: any[] = [];
  try {
    const res = await admin
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
      isLiveWindow: (!c.starts_on || c.starts_on <= today) && (!c.ends_on || c.ends_on >= today),
    })),
  ];
}

/**
 * The names of the athletes this viewer follows, used to pin their skater to
 * the top of the board. Names only. Must be called with the caller's
 * user-scoped client so RLS returns only their own/rostered athletes.
 */
export async function fetchMySkaterNames(userScoped: SupabaseClient<Database>): Promise<string[]> {
  const { data } = await userScoped.from("athletes").select("first_name, last_name");
  return (data ?? []).map((a) => `${a.first_name} ${a.last_name}`.trim());
}
