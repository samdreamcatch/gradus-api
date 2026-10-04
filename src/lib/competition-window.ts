/**
 * When a competition is "live": the one rule behind every LIVE tag on the
 * board (index, search, board header, rink tabs, schedule rows), for the web
 * and the iOS app alike, which only display what the API says.
 *
 * Browser-safe and free of server imports so it can be unit-tested and used
 * from list, catalog and board reads.
 *
 * Three things went wrong before this existed (Mariah, 2026-10-03: past
 * events tagged Live):
 * 1. IJS prints dates as `9/11/2026 - 9/13/2026` as often as
 *    `09/11/2026 - 09/13/2026`; the parser only took two-digit months and
 *    days, so the dates stayed null, and a null window counted as always live.
 * 2. "Today" was the UTC date, a day ahead of every US rink each evening.
 * 3. A snapshot built while an event was live was never rebuilt once the
 *    competition left its window, so that event read LIVE forever.
 */
import type { BoardPayload } from "./board-types";

/** Venue zone when IJS doesn't print one (same default as `RINK_TZ` in ijs-scrape.server.ts). */
export const DEFAULT_RINK_TZ = "America/New_York";

/** A published range longer than this is a typo on the source (seen: `02/06/2026 - 02/07/2027`). */
const MAX_SPAN_DAYS = 31;

/**
 * An event that started this recently may still be on the ice even though the
 * venue's date has rolled over (a late evening session running past midnight).
 */
export const LATE_EVENT_GRACE_MS = 6 * 60 * 60_000;

/**
 * Whether an event IJS calls live can be running at `now`: it is on today's
 * venue-local date, or it started within the last few hours.
 */
export function canStillBeLive(
  startAt: Date | null,
  dayKey: string | null,
  now: Date,
  todayKey: string,
): boolean {
  if (dayKey === todayKey) return true;
  if (!startAt) return dayKey === null;
  const since = +now - +startAt;
  return since >= 0 && since < LATE_EVENT_GRACE_MS;
}

export interface CompetitionWindow {
  /** First day, `YYYY-MM-DD`, venue-local. */
  start: string;
  /** Last day, inclusive. */
  end: string;
}

/** `9/11/2026 - 9/13/2026` or `08/18/2026 - 08/23/2026 (EDT)` -> ISO start/end dates. */
export function parseDateRange(label: string): { startsOn: string | null; endsOn: string | null } {
  const dates = [...(label ?? "").matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)]
    .map((m) => ({ y: Number(m[3]), mo: Number(m[1]), d: Number(m[2]) }))
    .filter(({ mo, d }) => mo >= 1 && mo <= 12 && d >= 1 && d <= 31)
    .map(({ y, mo, d }) => `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  return { startsOn: dates[0] ?? null, endsOn: dates[dates.length - 1] ?? null };
}

/** Venue-local `YYYY-MM-DD` for an instant. */
export function dayKeyIn(date: Date, timeZone = DEFAULT_RINK_TZ): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: DEFAULT_RINK_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }
}

/** `2026-09-30` + 1 -> `2026-10-01`. */
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

function spanDays(start: string, end: string): number {
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
}

/**
 * The days a competition runs: its published dates (stored, else parsed from
 * the label), widened to every day its schedule actually has events. A
 * published range that is backwards or implausibly long is ignored. Null when
 * nothing is known.
 */
export function competitionWindow(input: {
  startsOn?: string | null;
  endsOn?: string | null;
  datesLabel?: string | null;
  schedule?: { dayKey: string }[] | null;
}): CompetitionWindow | null {
  let start = input.startsOn ?? null;
  let end = input.endsOn ?? null;
  if (!start || !end) {
    const parsed = parseDateRange(input.datesLabel ?? "");
    start = start ?? parsed.startsOn;
    end = end ?? parsed.endsOn;
  }
  let published: CompetitionWindow | null = null;
  if (start && end) {
    const span = spanDays(start, end);
    if (span >= 0 && span <= MAX_SPAN_DAYS) published = { start, end };
  }

  const days = (input.schedule ?? [])
    .map((e) => e.dayKey)
    .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
    .sort();
  const scheduled = days.length ? { start: days[0]!, end: days[days.length - 1]! } : null;

  if (published && scheduled) {
    return {
      start: published.start < scheduled.start ? published.start : scheduled.start,
      end: published.end > scheduled.end ? published.end : scheduled.end,
    };
  }
  return published ?? scheduled;
}

export function isWithinWindow(window: CompetitionWindow | null, todayKey: string): boolean {
  return !!window && window.start <= todayKey && todayKey <= window.end;
}

/**
 * Whether a stale snapshot is worth rebuilding from IJS. Generous on purpose:
 * from the day before through the day after (late scores, a venue's evening
 * past UTC midnight), once more for a snapshot taken before the competition
 * ended (so its last events settle to their final state), and always when the
 * dates are unknown.
 */
export function wantsRefresh(
  window: CompetitionWindow | null,
  todayKey: string,
  generatedKey: string | null,
): boolean {
  if (!window) return true;
  if (todayKey >= addDays(window.start, -1) && todayKey <= addDays(window.end, 1)) return true;
  return todayKey > window.end && (generatedKey === null || generatedKey <= window.end);
}

/**
 * Nothing is live on a day that has passed, or outside the competition's
 * window. Settles a cached snapshot before it is served: a `live` schedule row
 * becomes `final` (it is showing results by now), and a rink still holding a
 * past event goes idle, with that event as the one that just finished.
 * Returns the same object when nothing needed settling.
 */
export function settleBoardPayload(
  payload: BoardPayload,
  opts: { now: Date; todayKey: string; inWindow: boolean; timeZone?: string },
): BoardPayload {
  const tz = opts.timeZone ?? payload.competition.timeZone ?? DEFAULT_RINK_TZ;
  const settles = (startIso: string | null, dayKey: string | null) => {
    if (!opts.inWindow) return true;
    const startAt = startIso ? new Date(startIso) : null;
    return !canStillBeLive(startAt, dayKey, opts.now, opts.todayKey);
  };

  let changed = false;
  const schedule = payload.schedule.map((e) => {
    if (e.status !== "live" || !settles(e.startIso, e.dayKey || null)) return e;
    changed = true;
    return { ...e, status: "final" as const };
  });
  const rinks = payload.rinks.map((r) => {
    if (r.state !== "live") return r;
    const startIso = r.current?.startIso ?? null;
    if (!settles(startIso, startIso ? dayKeyIn(new Date(startIso), tz) : null)) return r;
    changed = true;
    return {
      ...r,
      state: "idle" as const,
      current: null,
      alsoLive: [],
      justFinished:
        r.justFinished ??
        (r.current
          ? {
              event: [r.current.event, r.current.segment].filter(Boolean).join(" "),
              winner: null,
            }
          : null),
    };
  });
  return changed ? { ...payload, schedule, rinks } : payload;
}
