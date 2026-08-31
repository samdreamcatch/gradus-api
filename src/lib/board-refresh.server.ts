/**
 * Builds a Live Board snapshot from the IJS leaderboard and caches it.
 *
 * A hundred people in a rink must not become a hundred requests to USFS, so
 * every viewer reads one shared `competition_snapshots` row and only one
 * refresh at a time is allowed to touch the source.
 */

import {
  DONE_STATUSES,
  LIVE_STATUS,
  RINK_TZ,
  fetchPage,
  lanes,
  parseEvent,
  parseIndex,
  topFinishers,
  type IjsEvent,
  type IjsSkater,
} from "./ijs-scrape.server";
import type { BoardEvent, BoardPayload, BoardRink, BoardSkater } from "./board-types";

export const REFRESH_INTERVAL_MS = 30_000;
/** How long a claimed refresh is assumed to be in flight before another may run. */
const REFRESH_LOCK_MS = 45_000;

function skaterJson(s: IjsSkater | null, withProtocol = false): BoardSkater | null {
  if (!s) return null;
  return {
    start: s.start,
    of: s.of,
    name: s.name,
    club: s.club,
    group: s.group,
    segScore: s.segScore,
    total: s.total,
    place: s.segPlace,
    protocol: withProtocol ? s.protocol : null,
  };
}


function sameRinkDay(a: Date, b: Date): boolean {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: RINK_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(a) === fmt.format(b);
}

/** Parse the whole competition into a board payload. Venues are cached by file. */
export async function buildPayload(
  base: string,
  year: number,
  venueCache: Record<string, string>,
): Promise<{ payload: BoardPayload; venues: Record<string, string> }> {
  const { competition, events } = parseIndex(await fetchPage(`${base}/index.asp`), year);
  const now = new Date();
  const errors: string[] = [];
  const venues = { ...venueCache };

  const pageCache = new Map<string, Awaited<ReturnType<typeof parseEvent>>>();
  const loadEvent = async (file: string) => {
    const hit = pageCache.get(file);
    if (hit) return hit;
    const ev = parseEvent(await fetchPage(`${base}/${file}`));
    pageCache.set(file, ev);
    if (ev.venue) venues[file] = ev.venue;
    return ev;
  };

  const dated = events.filter((e): e is IjsEvent & { startAt: Date } => e.startAt !== null);

  // Pick the day to show: today, else the next day with events, else the last.
  let day = dated.filter((e) => sameRinkDay(e.startAt, now));
  if (day.length === 0) {
    const future = dated.filter((e) => e.startAt > now).sort((a, b) => +a.startAt - +b.startAt);
    if (future.length) {
      day = dated.filter((e) => sameRinkDay(e.startAt, future[0]!.startAt));
    } else if (dated.length) {
      const last = dated.reduce((a, b) => (b.startAt > a.startAt ? b : a));
      day = dated.filter((e) => sameRinkDay(e.startAt, last.startAt));
    }
  }

  // Resolve rinks. Venue only appears on the event page and never changes, so
  // it is discovered once and cached.
  for (const e of day) {
    if (venues[e.file]) {
      e.venue = venues[e.file];
      continue;
    }
    try {
      e.venue = (await loadEvent(e.file)).venue || "Unassigned";
    } catch (err) {
      e.venue = "Unassigned";
      errors.push(`${e.file}: ${(err as Error).message}`);
    }
  }

  const byRink = new Map<string, (IjsEvent & { startAt: Date })[]>();
  for (const e of day) {
    const key = e.venue || "Unassigned";
    const list = byRink.get(key) ?? [];
    list.push(e);
    byRink.set(key, list);
  }

  const rinks: BoardRink[] = [];
  for (const name of [...byRink.keys()].sort()) {
    const evs = (byRink.get(name) ?? []).sort((a, b) => +a.startAt - +b.startAt);
    const live = evs.filter((e) => e.status.toLowerCase() === LIVE_STATUS);
    const started = live.filter((e) => e.startAt <= now);
    const primary = started.length
      ? started.reduce((a, b) => (b.startAt > a.startAt ? b : a))
      : (live[0] ?? null);

    const rink: BoardRink = {
      name,
      state: "idle",
      current: null,
      next: null,
      justFinished: null,
      alsoLive: [],
      dayEvents: evs.length,
    };

    if (primary) {
      try {
        const ev = await loadEvent(primary.file);
        const L = lanes(ev);
        rink.state = "live";
        rink.current = {
          event: ev.event,
          segment: ev.segment,
          status: ev.status,
          skaters: ev.count,
          withdrawn: ev.withdrawn,
          done: L.done,
          startLabel: primary.timeLabel,
          startIso: primary.startAt.toISOString(),
          url: `${base}/${primary.file}`,
          justScored: skaterJson(L.justScored),
          onIce: skaterJson(L.onIce),
          upNext: skaterJson(L.upNext),
          startOrder: ev.skaters.map((s) => ({ start: s.start, name: s.name, club: s.club })),
        };
        rink.alsoLive = live.filter((e) => e.file !== primary.file).map((e) => e.name);
      } catch (err) {
        errors.push(`${name} live: ${(err as Error).message}`);
      }
    }

    const done = evs.filter(
      (e) => DONE_STATUSES.includes(e.status.toLowerCase()) && e.startAt <= now,
    );
    if (done.length && rink.state === "idle") {
      const jf = done.reduce((a, b) => (b.startAt > a.startAt ? b : a));
      rink.justFinished = { event: jf.name, winner: null };
      try {
        const top = topFinishers(await loadEvent(jf.file), 1);
        if (top[0]) {
          rink.justFinished.winner = {
            name: top[0].name,
            club: top[0].club,
            score: top[0].total || top[0].segScore,
          };
        }
      } catch {
        // A missing winner is cosmetic; the countdown still renders.
      }
    }

    const upcoming = evs.filter((e) => e.startAt > now && (!primary || e.file !== primary.file));
    if (upcoming[0]) {
      const nxt = upcoming[0];
      const item = {
        event: nxt.name,
        timeLabel: nxt.timeLabel,
        startIso: nxt.startAt.toISOString(),
        skaters: null as number | null,
        url: `${base}/${nxt.file}`,
      };
      try {
        item.skaters = (await loadEvent(nxt.file)).count;
      } catch {
        // Skater count is optional.
      }
      rink.next = item;
    }

    rinks.push(rink);
  }

  return {
    payload: {
      generatedAt: now.toISOString(),
      competition: {
        name: competition.name,
        dates: competition.dates,
        location: competition.location,
        url: `${base}/index.asp`,
      },
      rinks,
      errors,
    },
    venues,
  };
}

interface CompetitionRow {
  id: string;
  ijs_base_url: string;
  year: number;
}

/**
 * Refresh one competition's snapshot. Returns the payload it wrote, or null if
 * another refresh already holds the lock (the caller then serves the cache).
 */
export async function refreshCompetition(
  comp: CompetitionRow,
  opts: { force?: boolean } = {},
): Promise<BoardPayload | null> {
  const mod = await import("@/integrations/supabase/client.server");
  // The board tables are new; use an untyped handle until types regenerate.
  const db = mod.supabaseAdmin as unknown as {
    from: (t: string) => any;
  };

  const existing = await db
    .from("competition_snapshots")
    .select("competition_id, venues, generated_at, refreshing_at, fetch_count")
    .eq("competition_id", comp.id)
    .maybeSingle();

  const nowIso = new Date().toISOString();
  const row = existing.data as
    | { venues: Record<string, string>; refreshing_at: string | null; fetch_count: number }
    | null;

  if (!opts.force && row?.refreshing_at) {
    const age = Date.now() - new Date(row.refreshing_at).getTime();
    if (age < REFRESH_LOCK_MS) return null;
  }

  // Claim the refresh so concurrent viewers don't stampede the source.
  await db
    .from("competition_snapshots")
    .upsert(
      { competition_id: comp.id, refreshing_at: nowIso, updated_at: nowIso },
      { onConflict: "competition_id" },
    );

  try {
    const { payload, venues } = await buildPayload(
      comp.ijs_base_url,
      comp.year,
      (row?.venues as Record<string, string>) ?? {},
    );
    await db.from("competition_snapshots").upsert(
      {
        competition_id: comp.id,
        payload: payload as unknown as Record<string, unknown>,
        venues,
        generated_at: payload.generatedAt,
        refreshing_at: null,
        error: payload.errors.length ? payload.errors.join(" · ") : null,
        fetch_count: (row?.fetch_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "competition_id" },
    );
    return payload;
  } catch (err) {
    await db.from("competition_snapshots").upsert(
      {
        competition_id: comp.id,
        refreshing_at: null,
        error: (err as Error).message,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "competition_id" },
    );
    return null;
  }
}
