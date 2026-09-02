/**
 * Server-only helpers for linking a rostered athlete to a skater in a finished
 * competition, and for pulling that skater's judged protocols.
 *
 * Everything here reads the same published USFS pages the Live Board already
 * reads. Nothing is written for a skater who has not been linked by their coach.
 */

import { DONE_STATUSES, fetchPage, parseEvent, parseIndex } from "./ijs-scrape.server";
import { normalizeName } from "./board-types";
import type { SkaterProtocol } from "./board-types";

/** One event a named skater appeared in, as published. */
export interface IndexedSkaterEvent {
  file: string;
  event: string;
  segment: string;
  day: string;
  place: string;
  score: string;
}

export interface IndexedSkater {
  name: string;
  club: string;
  events: IndexedSkaterEvent[];
}

export interface SkaterIndex {
  builtAt: string;
  skaters: IndexedSkater[];
}

/** Cache lifetime for the per-competition skater index. */
export const SKATER_INDEX_TTL_MS = 24 * 60 * 60_000;

/** Fetch pages a few at a time so one competition never floods the source. */
async function inBatches<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    out.push(...(await Promise.all(slice.map(fn))));
  }
  return out;
}

/**
 * Walk every finished event of a competition and collect the skaters who
 * appear, with the events they skated. Protocols are not stored here — they are
 * fetched for one skater at link time.
 */
export async function buildSkaterIndex(base: string, year: number): Promise<SkaterIndex> {
  const { events } = parseIndex(await fetchPage(`${base}/index.asp`), year);
  const done = events.filter((e) => DONE_STATUSES.includes(e.status.toLowerCase())).slice(0, 200);

  const byName = new Map<string, IndexedSkater>();

  await inBatches(done, 5, async (e) => {
    let page: ReturnType<typeof parseEvent>;
    try {
      page = parseEvent(await fetchPage(`${base}/${e.file}`));
    } catch {
      return; // a single unreadable event must not sink the index
    }
    for (const s of page.skaters) {
      if (!s.name) continue;
      const key = normalizeName(s.name);
      const entry = byName.get(key) ?? { name: s.name, club: s.club, events: [] };
      if (!entry.club && s.club) entry.club = s.club;
      entry.events.push({
        file: e.file,
        event: page.event || e.name,
        segment: page.segment,
        day: e.day,
        place: s.place || s.segPlace,
        score: s.total || s.segScore,
      });
      byName.set(key, entry);
    }
  });

  return { builtAt: new Date().toISOString(), skaters: [...byName.values()] };
}

/** 0–1 similarity between two names, tolerant of nicknames and middle names. */
export function nameScore(athlete: string, skater: string): number {
  const a = normalizeName(athlete).split(" ").filter(Boolean);
  const b = normalizeName(skater).split(" ").filter(Boolean);
  if (!a.length || !b.length) return 0;
  if (a.join(" ") === b.join(" ")) return 1;

  const aLast = a[a.length - 1]!;
  const bLast = b[b.length - 1]!;
  const aFirst = a[0]!;
  const bFirst = b[0]!;

  let score = 0;
  if (aLast === bLast) score += 0.6;
  if (aFirst === bFirst) score += 0.4;
  else if (aFirst.startsWith(bFirst) || bFirst.startsWith(aFirst)) score += 0.25;
  return Math.min(score, 0.99);
}

export interface FetchedResult {
  eventName: string;
  segment: string;
  rink: string;
  eventFile: string;
  startOrder: number | null;
  placement: string;
  segmentScore: string;
  totalScore: string;
  protocol: SkaterProtocol | null;
}

/**
 * Re-read the events a linked skater appeared in and return their published
 * result and judged protocol for each one.
 */
export async function fetchSkaterResults(
  base: string,
  files: string[],
  skaterName: string,
): Promise<FetchedResult[]> {
  const key = normalizeName(skaterName);
  const out: FetchedResult[] = [];

  await inBatches([...new Set(files)].slice(0, 12), 3, async (file) => {
    let page: ReturnType<typeof parseEvent>;
    try {
      page = parseEvent(await fetchPage(`${base}/${file}`));
    } catch {
      return;
    }
    const s = page.skaters.find((x) => normalizeName(x.name) === key);
    if (!s) return;
    out.push({
      eventName: page.event || file,
      segment: page.segment,
      rink: page.venue,
      eventFile: file,
      startOrder: Number.isFinite(s.start) ? s.start : null,
      placement: s.place || s.segPlace,
      segmentScore: s.segScore,
      totalScore: s.total,
      protocol: s.protocol,
    });
  });

  return out;
}
