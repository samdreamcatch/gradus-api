/**
 * Pure Live Board helpers shared by the board UI (`components/board/*`) and
 * the server-side Live Activity sync (`live-activities.server.ts`). Moved
 * here verbatim from `components/board/my-skaters.tsx` so server code can
 * use them without importing a React component; that file re-exports them.
 * The iOS app ports the same rules in `BoardLogic.swift`, so the three must
 * not drift.
 */
import { normalizeName, type BoardEvent, type BoardPayload, type BoardSkater } from "./board-types";

export interface SkaterMatch {
  key: string;
  skater: BoardSkater;
  event: BoardEvent;
  /** How many skaters have posted a score in this event. */
  done: number;
  /** Skaters between this one and the ice. Negative once they have skated. */
  ahead: number;
  state: "scored" | "on-ice" | "up-next" | "waiting" | "scheduled";
  sortAt: number;
}

/** Loose identity for an event: the schedule and the rink panel often label the
 *  same event slightly differently ("Name / Free Skate" vs name + segment). */
export function eventKey(name: string, segment: string, rink: string): string {
  const text = `${name} ${segment}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w, i, a) => a.indexOf(w) === i)
    .join(" ");
  return `${rink.toLowerCase().trim()}|${text}`;
}

/** Every event on the day, plus the live events held in the rink panels. */
export function allEvents(payload: BoardPayload): BoardEvent[] {
  const list = [...(payload.schedule ?? [])];
  for (const rink of payload.rinks) {
    const c = rink.current;
    if (!c) continue;
    const key = eventKey(c.event, c.segment, rink.name);
    const known = list.find((e) => eventKey(e.name, e.segment, e.rink) === key);
    if (known) {
      if (known.results.length === 0) known.results = c.startOrder;
      continue;
    }

    list.push({
      file: `${rink.name}:${c.event}`,
      name: c.event,
      segment: c.segment,
      rink: rink.name,
      timeLabel: c.startLabel,
      startIso: c.startIso,
      status: "live",
      count: c.skaters,
      dayLabel: "",
      dayKey: c.startIso ? c.startIso.slice(0, 10) : "",
      results: c.startOrder,
    });
  }
  return list;
}

/** Find every athlete this viewer follows anywhere in the day's schedule. */
export function findMySkaters(payload: BoardPayload | null, names: string[]): SkaterMatch[] {
  if (!payload || names.length === 0) return [];
  const wanted = new Set(names.map(normalizeName));
  const out: SkaterMatch[] = [];

  for (const event of allEvents(payload)) {
    const done = event.results.filter((s) => s.segScore).length;
    for (const s of event.results) {
      if (!wanted.has(normalizeName(s.name))) continue;
      const ahead = s.start - done - 1;
      const state: SkaterMatch["state"] = s.segScore
        ? "scored"
        : event.status !== "live"
          ? "scheduled"
          : ahead <= 0
            ? "on-ice"
            : ahead === 1
              ? "up-next"
              : "waiting";
      const start = event.startIso ? new Date(event.startIso).getTime() : Number.MAX_SAFE_INTEGER;
      out.push({
        key: `${event.file}:${s.start}:${s.name}`,
        skater: s,
        event,
        done,
        ahead,
        state,
        sortAt: state === "scored" ? start + 1e11 : state === "scheduled" ? start : start - 1e11,
      });
    }
  }

  return out.sort((a, b) => a.sortAt - b.sortAt);
}

/** One skate: a skater's row in one event, scored or still to come. */
export interface Skate {
  event: BoardEvent;
  skater: BoardSkater;
  /** The event's page on the official results site, where the full protocol lives. */
  officialUrl: string | null;
}

/**
 * What a tap on a skater opens, from every board surface (the wheel and lanes,
 * My skaters, the follow search, event results): their every skate at this
 * competition, the one tapped first. Mariah, 2026-10-03: the same skater
 * looked different depending on where they were tapped.
 */
export interface ScoreSelection {
  name: string;
  club: string;
  skates: Skate[];
}

/** `https://…/37055/index.asp` -> `https://…/37055/`. */
function officialBase(index: string): string | null {
  if (!/^https?:\/\//i.test(index)) return null;
  return index.replace(/[^/]*$/, "");
}

/**
 * Every skate one skater has at this competition, the tapped event first and
 * the rest in schedule order. The tapped row wins for its own event when it
 * carries the protocol and the schedule's copy doesn't (the rink panel always
 * carries it; the schedule only for recent events). Same rule as
 * `BoardLogic.skates` on iOS.
 */
export function skatesOf(
  payload: BoardPayload | null,
  key: string,
  opts: { tapped?: BoardSkater | null; focusKey?: string | null } = {},
): Skate[] {
  if (!payload || !key) return [];
  const base = officialBase(payload.competition.url);
  const out: Skate[] = [];
  let focusIndex = -1;
  for (const event of allEvents(payload)) {
    const isFocus =
      !!opts.focusKey && eventKey(event.name, event.segment, event.rink) === opts.focusKey;
    for (const row of event.results) {
      if (normalizeName(row.name) !== key) continue;
      const tapped = opts.tapped;
      const skater =
        isFocus &&
        tapped &&
        normalizeName(tapped.name) === key &&
        tapped.start === row.start &&
        !row.protocol &&
        tapped.protocol
          ? tapped
          : row;
      if (isFocus && focusIndex < 0) focusIndex = out.length;
      out.push({ event, skater, officialUrl: base ? `${base}${event.file}` : null });
    }
  }
  if (focusIndex > 0) out.unshift(...out.splice(focusIndex, 1));
  return out;
}

/** The selection a tap on `skater` opens; `focusKey` is the event tapped from. */
export function scoreSelectionFor(
  payload: BoardPayload | null,
  skater: BoardSkater,
  focusKey?: string | null,
): ScoreSelection {
  const skates = skatesOf(payload, normalizeName(skater.name), { tapped: skater, focusKey });
  const club = skater.club || skates.find((s) => s.skater.club)?.skater.club || "";
  return { name: skater.name, club, skates };
}
