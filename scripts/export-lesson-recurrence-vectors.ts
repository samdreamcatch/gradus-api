/**
 * Writes docs/api/vectors/lesson-recurrence.json: cases for
 * `expandSlotOccurrences` (src/lib/lesson-recurrence.ts) that the native
 * clients run against their ports (PRD §9.5 "Recurrence and formatting
 * parity"). `bun scripts/export-lesson-recurrence-vectors.ts`;
 * src/lib/lesson-recurrence.test.ts fails when the file drifts from the
 * source. `expected` is always regenerated from the TypeScript function.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expandSlotOccurrences, type RecurringSlot } from "../src/lib/lesson-recurrence";

type Case = {
  name: string;
  input: { slot: RecurringSlot; from: string; to: string };
  expected: string[];
};

const inputs: Array<{ name: string; slot: RecurringSlot; from: string; to: string }> = [
  {
    name: "weekly: every Tuesday in a window that starts on a Sunday",
    slot: { dayOfWeek: 2, frequency: "weekly", weeksOfMonth: [], startsOn: null },
    from: "2026-09-06",
    to: "2026-10-04",
  },
  {
    name: "weekly: the window starts on the matching weekday",
    slot: { dayOfWeek: 1, frequency: "weekly", weeksOfMonth: [], startsOn: null },
    from: "2026-09-07",
    to: "2026-09-21",
  },
  {
    name: "weekly: startsOn floors the first occurrence",
    slot: { dayOfWeek: 4, frequency: "weekly", weeksOfMonth: [], startsOn: "2026-09-18" },
    from: "2026-09-01",
    to: "2026-10-01",
  },
  {
    name: "weekly: startsOn after the window yields nothing",
    slot: { dayOfWeek: 4, frequency: "weekly", weeksOfMonth: [], startsOn: "2026-11-01" },
    from: "2026-09-01",
    to: "2026-10-01",
  },
  {
    name: "weekly: from after to yields nothing",
    slot: { dayOfWeek: 0, frequency: "weekly", weeksOfMonth: [], startsOn: null },
    from: "2026-09-20",
    to: "2026-09-10",
  },
  {
    name: "weekly: single-day window on the weekday",
    slot: { dayOfWeek: 6, frequency: "weekly", weeksOfMonth: [], startsOn: null },
    from: "2026-09-12",
    to: "2026-09-12",
  },
  {
    name: "biweekly: anchored on a Monday, window starts on the anchor",
    slot: { dayOfWeek: 1, frequency: "biweekly", weeksOfMonth: [], startsOn: "2026-09-07" },
    from: "2026-09-07",
    to: "2026-11-02",
  },
  {
    name: "biweekly: anchor on a different weekday than the slot (phase from the anchor's next Wednesday)",
    slot: { dayOfWeek: 3, frequency: "biweekly", weeksOfMonth: [], startsOn: "2026-09-04" },
    from: "2026-09-01",
    to: "2026-10-31",
  },
  {
    name: "biweekly: window starts on an off week",
    slot: { dayOfWeek: 1, frequency: "biweekly", weeksOfMonth: [], startsOn: "2026-09-07" },
    from: "2026-09-14",
    to: "2026-10-12",
  },
  {
    name: "biweekly: no anchor falls back to every matching week",
    slot: { dayOfWeek: 5, frequency: "biweekly", weeksOfMonth: [], startsOn: null },
    from: "2026-09-01",
    to: "2026-09-30",
  },
  {
    name: "biweekly: across the DST end (first Sunday of November, US)",
    slot: { dayOfWeek: 0, frequency: "biweekly", weeksOfMonth: [], startsOn: "2026-10-18" },
    from: "2026-10-18",
    to: "2026-12-13",
  },
  {
    name: "twice monthly: 1st and 3rd Thursdays",
    slot: { dayOfWeek: 4, frequency: "twice_monthly", weeksOfMonth: [1, 3], startsOn: null },
    from: "2026-09-01",
    to: "2026-11-30",
  },
  {
    name: "twice monthly: 2nd and 4th Saturdays with a floor",
    slot: {
      dayOfWeek: 6,
      frequency: "twice_monthly",
      weeksOfMonth: [2, 4],
      startsOn: "2026-09-15",
    },
    from: "2026-09-01",
    to: "2026-10-31",
  },
  {
    name: "monthly: 2nd Wednesday",
    slot: { dayOfWeek: 3, frequency: "monthly", weeksOfMonth: [2], startsOn: null },
    from: "2026-09-01",
    to: "2027-01-31",
  },
  {
    name: "monthly: 5th Friday only in months that have one",
    slot: { dayOfWeek: 5, frequency: "monthly", weeksOfMonth: [5], startsOn: null },
    from: "2026-09-01",
    to: "2027-02-28",
  },
  {
    name: "monthly: empty weeksOfMonth never fires",
    slot: { dayOfWeek: 2, frequency: "monthly", weeksOfMonth: [], startsOn: null },
    from: "2026-09-01",
    to: "2026-12-31",
  },
  {
    name: "weekly across a leap day",
    slot: { dayOfWeek: 0, frequency: "weekly", weeksOfMonth: [], startsOn: null },
    from: "2028-02-20",
    to: "2028-03-12",
  },
];

export const LESSON_RECURRENCE_VECTOR = {
  description:
    "Every date a recurring lesson slot lands on inside an inclusive window. Weekly fires every matching weekday; biweekly every other one, phased from the first matching weekday on or after startsOn (no anchor: every week); twice_monthly and monthly fire on the listed 1-based ordinals of the weekday within the month (a 5th ordinal exists only in some months). Dates before startsOn are never returned; from > to returns nothing. Dates are calendar dates with no time zone.",
  source: "src/lib/lesson-recurrence.ts",
  cases: inputs.map(
    ({ name, slot, from, to }): Case => ({
      name,
      input: { slot, from, to },
      expected: expandSlotOccurrences(slot, from, to),
    }),
  ),
};

if (import.meta.main) {
  const out = fileURLToPath(new URL("../docs/api/vectors/lesson-recurrence.json", import.meta.url));
  writeFileSync(out, `${JSON.stringify(LESSON_RECURRENCE_VECTOR, null, 2)}\n`);
  console.log(`Wrote ${out}`);
}
