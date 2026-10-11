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
import { DEMO_SLUG, buildDemoBoard } from "./board-demo";
import {
  competitionWindow,
  dayKeyIn,
  isWithinWindow,
  parseDateRange,
  settleBoardPayload,
  wantsRefresh,
} from "./competition-window";

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

  const select =
    "id, slug, name, dates_label, location, active, starts_on, ends_on, ijs_base_url, year";
  let comp = await admin.from("competitions").select(select).eq("slug", slug).maybeSingle();
  if (!comp.data) {
    // A competition found by the IJS catalog (`ijs-<year>-<id>`) gets its board
    // the first time anyone opens it (src/lib/ijs-catalog.server.ts).
    const { materializeCatalogBoard } = await import("./ijs-catalog.server");
    const made = await materializeCatalogBoard(admin, slug);
    if (!made) return null;
    comp = await admin.from("competitions").select(select).eq("slug", made).maybeSingle();
    if (!comp.data) return null;
  }
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

  // Rows saved before the date parser took `9/11/2026` have no dates; read
  // them from the label, and store them so recaps and ordering see them too.
  if (!c.starts_on || !c.ends_on) {
    const parsed = parseDateRange(c.dates_label ?? "");
    if (parsed.startsOn && parsed.endsOn) {
      c.starts_on = c.starts_on ?? parsed.startsOn;
      c.ends_on = c.ends_on ?? parsed.endsOn;
      try {
        await admin
          .from("competitions")
          .update({ starts_on: c.starts_on, ends_on: c.ends_on })
          .eq("id", c.id);
      } catch {
        // Best effort: the board reads the label either way.
      }
    }
  }

  let payload = cached?.payload ?? null;
  // The cache row comes back as `+00:00`, a fresh refresh as `Z`. One shape,
  // or the ETag (slug + generatedAt) flips between the two on every poll.
  let generatedAt = cached?.generated_at ? new Date(cached.generated_at).toISOString() : null;
  const stale = !generatedAt || Date.now() - new Date(generatedAt).getTime() > REFRESH_INTERVAL_MS;

  const now = new Date();
  const windowOf = (p: BoardPayload | null) =>
    competitionWindow({
      startsOn: c.starts_on,
      endsOn: c.ends_on,
      datesLabel: c.dates_label,
      schedule: p?.schedule,
    });
  const timeZone = payload?.competition.timeZone;
  const generatedKey = generatedAt ? dayKeyIn(new Date(generatedAt), timeZone) : null;

  if (
    !payload ||
    (c.active && stale && wantsRefresh(windowOf(payload), dayKeyIn(now, timeZone), generatedKey))
  ) {
    const fresh = await refreshCompetition({
      id: c.id,
      ijs_base_url: c.ijs_base_url,
      year: c.year,
      slug: c.slug,
      name: c.name,
    });
    if (fresh) {
      payload = fresh;
      generatedAt = fresh.generatedAt;
    }
  }

  // Live means today, venue-local, falls inside the competition's days.
  const todayKey = dayKeyIn(now, payload?.competition.timeZone);
  const isLiveWindow = c.active && isWithinWindow(windowOf(payload), todayKey);
  if (payload) {
    payload = settleBoardPayload(payload, { now, todayKey, inWindow: isLiveWindow });
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

/** Competitions with a board, newest first. The sample board is reachable by link only. */
export async function fetchBoardList(admin: AdminDb): Promise<BoardListEntry[]> {
  let rows: any[] = [];
  try {
    const res = await admin
      .from("competitions")
      .select("slug, name, dates_label, location, active, starts_on, ends_on, comp_id, year")
      .eq("active", true)
      .order("starts_on", { ascending: false, nullsFirst: false });
    rows = (res?.data ?? []) as any[];
  } catch {
    // Table not available yet — the built-in sample board still lists.
    rows = [];
  }
  const today = dayKeyIn(new Date());

  // Every IJS competition on today, found by the catalog sweep, joins the
  // boards set up in admin ("Happening now" with no setup; 2026-09-26).
  let catalog: BoardListEntry[] = [];
  try {
    const { liveCatalogEntries, toBoardEntries } = await import("./ijs-catalog.server");
    const known = new Set(rows.map((c) => `${c.year}-${c.comp_id}`));
    const live = (await liveCatalogEntries(admin, today)).filter(
      (e) => !known.has(`${e.year}-${e.compId}`),
    );
    catalog = await toBoardEntries(admin, live, today);
  } catch {
    // Catalog table not there yet: the admin-set-up boards still list.
    catalog = [];
  }

  return [
    ...rows.map((c) => ({
      slug: c.slug as string,
      name: c.name as string,
      datesLabel: c.dates_label as string,
      location: c.location as string,
      isLiveWindow: isWithinWindow(
        competitionWindow({ startsOn: c.starts_on, endsOn: c.ends_on, datesLabel: c.dates_label }),
        today,
      ),
    })),
    ...catalog,
  ];
}

/**
 * Search every IJS competition the catalog knows, or look up a pasted IJS
 * link or competition number on the spot. Thin wrapper over `searchCatalog`.
 */
export async function searchBoards(admin: AdminDb, q: string): Promise<BoardListEntry[]> {
  const { searchCatalog } = await import("./ijs-catalog.server");
  return searchCatalog(admin, q);
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
