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
    finalPlace: s.place,
    segScores: s.segScores.length > 1 ? s.segScores : undefined,
    protocol: withProtocol ? s.protocol : null,
  };
}

const DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: RINK_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Venue-local `YYYY-MM-DD` for grouping a competition into days. */
function dayKeyOf(d: Date): string {
  return DAY_FMT.format(d);
}

function sameRinkDay(a: Date, b: Date): boolean {
  return dayKeyOf(a) === dayKeyOf(b);
}

/** Lean, cached results for one event file at one status. */
export interface CachedEvent {
  count: number;
  results: BoardSkater[];
}

/** How long after an event a full protocol is still worth carrying. */
const PROTOCOL_WINDOW_MS = 3 * 60 * 60_000;

/**
 * Parse the whole competition into a board payload. Venues and per-event start
 * orders are cached by file so a finished event is fetched once, not every
 * thirty seconds.
 */
export async function buildPayload(
  base: string,
  year: number,
  venueCache: Record<string, string>,
  orderCache: Record<string, CachedEvent> = {},
): Promise<{
  payload: BoardPayload;
  venues: Record<string, string>;
  orders: Record<string, CachedEvent>;
}> {
  const { competition, events } = parseIndex(await fetchPage(`${base}/index.asp`), year);
  const now = new Date();
  const errors: string[] = [];
  const venues = { ...venueCache };
  const orders: Record<string, CachedEvent> = {};

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
          startOrder: ev.skaters.map((s) => skaterJson(s, true)!),
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

  // The departures board. Every event of the whole competition, in start order,
  // with its results when we already know them. Pages are fetched once per
  // status change and then read from the cache, so past days cost nothing after
  // the first pass; future events on other days are not fetched at all.
  const schedule: BoardEvent[] = [];
  const dayKeys = new Set(day.map((e) => dayKeyOf(e.startAt)));
  for (const e of dated) {
    const raw = e.status.toLowerCase();
    const status: BoardEvent["status"] = DONE_STATUSES.includes(raw)
      ? "final"
      : raw === LIVE_STATUS
        ? "live"
        : "scheduled";
    const key = `${e.file}:${raw}`;
    const withProtocol = +e.startAt >= Date.now() - PROTOCOL_WINDOW_MS;
    const onShownDay = dayKeys.has(dayKeyOf(e.startAt));
    const worthFetching = onShownDay || status !== "scheduled";

    let entry: CachedEvent | null = null;
    const loaded = pageCache.get(e.file);
    if (loaded) {
      entry = {
        count: loaded.count,
        results: loaded.skaters.map((s) => skaterJson(s, withProtocol)!),
      };
    } else if (orderCache[key]) {
      entry = orderCache[key]!;
    } else if (worthFetching) {
      try {
        const ev = await loadEvent(e.file);
        entry = { count: ev.count, results: ev.skaters.map((s) => skaterJson(s, withProtocol)!) };
      } catch (err) {
        errors.push(`${e.file}: ${(err as Error).message}`);
      }
    }
    if (entry) orders[key] = entry;

    schedule.push({
      file: e.file,
      name: e.name,
      segment: pageCache.get(e.file)?.segment ?? "",
      rink: e.venue || venues[e.file] || "Unassigned",
      timeLabel: e.timeLabel,
      startIso: e.startAt.toISOString(),
      status,
      count: entry?.count ?? null,
      dayLabel: e.day,
      dayKey: dayKeyOf(e.startAt),
      results: entry?.results ?? [],
    });
  }
  schedule.sort((a, b) => (a.startIso ?? "").localeCompare(b.startIso ?? ""));

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
      schedule,
      errors,
    },
    venues,
    orders,
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
    .select("competition_id, venues, orders, generated_at, refreshing_at, fetch_count")
    .eq("competition_id", comp.id)
    .maybeSingle();

  const nowIso = new Date().toISOString();
  const row = existing.data as {
    venues: Record<string, string>;
    orders: Record<string, CachedEvent> | null;
    refreshing_at: string | null;
    fetch_count: number;
  } | null;

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
    const { payload, venues, orders } = await buildPayload(
      comp.ijs_base_url,
      comp.year,
      (row?.venues as Record<string, string>) ?? {},
      row?.orders ?? {},
    );
    await db.from("competition_snapshots").upsert(
      {
        competition_id: comp.id,
        payload: payload as unknown as Record<string, unknown>,
        venues,
        orders,
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
