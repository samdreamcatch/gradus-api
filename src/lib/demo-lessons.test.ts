import { describe, expect, it } from "bun:test";
import { demoLessonSlots } from "./demo-lessons";

// The iOS Up next card (`WeekSchedule.upNext`): a lesson today that hasn't
// ended and starts within the next 120 minutes.
function hasUpNext(rows: ReturnType<typeof demoLessonSlots>, day: number, now: number): boolean {
  return rows.some(
    (r) => r.day_of_week === day && r.end_minute > now && r.start_minute - now <= 120,
  );
}

describe("demoLessonSlots", () => {
  const rows = demoLessonSlots("athlete-1", "coach-1");

  it("schedules 9, 11, 1, 3 and 5 o'clock on every day of the week", () => {
    expect(rows).toHaveLength(35);
    for (let day = 0; day < 7; day++) {
      expect(rows.filter((r) => r.day_of_week === day).map((r) => r.start_minute)).toEqual([
        540, 660, 780, 900, 1020,
      ]);
    }
  });

  it("keeps the Up next briefing on screen from 7am to 6pm every day", () => {
    for (let day = 0; day < 7; day++) {
      for (let now = 7 * 60; now < 18 * 60; now++) {
        expect(hasUpNext(rows, day, now)).toBe(true);
      }
    }
  });

  it("writes rows the slot table accepts", () => {
    for (const r of rows) {
      expect(r.end_minute).toBeGreaterThan(r.start_minute);
      expect(r.end_minute).toBeLessThanOrEqual(1440);
      expect(r.coach_id).toBe("coach-1");
      expect(r.athlete_id).toBe("athlete-1");
    }
  });
});
