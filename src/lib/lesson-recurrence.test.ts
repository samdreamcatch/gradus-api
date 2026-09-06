import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LESSON_RECURRENCE_VECTOR } from "../../scripts/export-lesson-recurrence-vectors";
import { expandSlotOccurrences } from "./lesson-recurrence";

describe("lesson recurrence contract vector", () => {
  it("matches the source (run `bun scripts/export-lesson-recurrence-vectors.ts` after editing the cases or the function)", () => {
    const file = fileURLToPath(
      new URL("../../docs/api/vectors/lesson-recurrence.json", import.meta.url),
    );
    const onDisk = JSON.parse(readFileSync(file, "utf8"));
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(LESSON_RECURRENCE_VECTOR)));
  });

  it("pins the semantics the vectors document", () => {
    // Weekly: every Tuesday.
    expect(
      expandSlotOccurrences(
        { dayOfWeek: 2, frequency: "weekly", weeksOfMonth: [], startsOn: null },
        "2026-09-06",
        "2026-09-20",
      ),
    ).toEqual(["2026-09-08", "2026-09-15"]);
    // Biweekly phases from the anchor's own weekday occurrence.
    expect(
      expandSlotOccurrences(
        { dayOfWeek: 1, frequency: "biweekly", weeksOfMonth: [], startsOn: "2026-09-07" },
        "2026-09-14",
        "2026-09-28",
      ),
    ).toEqual(["2026-09-21"]);
    // Monthly: 5th Friday exists in October 2026 but not September.
    expect(
      expandSlotOccurrences(
        { dayOfWeek: 5, frequency: "monthly", weeksOfMonth: [5], startsOn: null },
        "2026-09-01",
        "2026-10-31",
      ),
    ).toEqual(["2026-10-30"]);
    // from > to.
    expect(
      expandSlotOccurrences(
        { dayOfWeek: 0, frequency: "weekly", weeksOfMonth: [], startsOn: null },
        "2026-09-20",
        "2026-09-10",
      ),
    ).toEqual([]);
  });
});
