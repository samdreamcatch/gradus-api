/**
 * Lesson recurrence expansion.
 *
 * The calendar stores recurring templates (`athlete_lesson_slots`), not
 * per-date rows. Invoicing needs the concrete dates a slot lands on inside a
 * window, so this module turns a template into occurrence dates.
 *
 * Semantics mirror the parent schedule editor:
 * - `weekly`        — every matching weekday.
 * - `biweekly`      — every other matching weekday, anchored on `startsOn`.
 * - `twice_monthly` — the two selected weeks of the month.
 * - `monthly`       — the single selected week of the month.
 */

export type LessonFrequency = "weekly" | "biweekly" | "twice_monthly" | "monthly";

export type RecurringSlot = {
  /** 0 = Sunday .. 6 = Saturday (database convention). */
  dayOfWeek: number;
  frequency: LessonFrequency;
  /** 1-based week-of-month selections, used by monthly / twice-monthly. */
  weeksOfMonth: number[];
  /** YYYY-MM-DD. Anchor for biweekly and a floor for every frequency. */
  startsOn: string | null;
};

/** Parse a YYYY-MM-DD string into a local-noon Date (DST-safe arithmetic). */
export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

export function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** 1-based ordinal of this date's weekday within its month (1st Tuesday = 1). */
function weekOfMonth(d: Date): number {
  return Math.floor((d.getDate() - 1) / 7) + 1;
}

/** Whole weeks between two dates, used to phase biweekly slots. */
function weeksBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / (7 * 24 * 60 * 60 * 1000));
}

/**
 * Every date the slot occurs on within `[startIso, endIso]`, inclusive.
 * Dates before `slot.startsOn` are never returned.
 */
export function expandSlotOccurrences(
  slot: RecurringSlot,
  startIso: string,
  endIso: string,
): string[] {
  const end = parseIsoDate(endIso);
  const floor = slot.startsOn ? parseIsoDate(slot.startsOn) : null;
  let cursor = parseIsoDate(startIso);
  if (floor && floor > cursor) cursor = floor;
  if (cursor > end) return [];

  // Advance to the first matching weekday.
  const delta = (slot.dayOfWeek - cursor.getDay() + 7) % 7;
  cursor = addDays(cursor, delta);

  const out: string[] = [];
  // Biweekly phase: the anchor's own weekday occurrence.
  let anchor: Date | null = null;
  if (slot.frequency === "biweekly" && floor) {
    anchor = addDays(floor, (slot.dayOfWeek - floor.getDay() + 7) % 7);
  }

  while (cursor <= end) {
    let include = true;
    if (slot.frequency === "biweekly") {
      include = anchor ? weeksBetween(anchor, cursor) % 2 === 0 : true;
    } else if (slot.frequency === "monthly" || slot.frequency === "twice_monthly") {
      include = slot.weeksOfMonth.includes(weekOfMonth(cursor));
    }
    if (include) out.push(toIsoDate(cursor));
    cursor = addDays(cursor, 7);
  }
  return out;
}
