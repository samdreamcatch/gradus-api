import { describe, expect, it } from "bun:test";
import { scheduleSlotSchema } from "./athlete-schema";

describe("scheduleSlotSchema", () => {
  const slot = {
    dayOfWeek: 1,
    startMinute: 600,
    endMinute: 660,
    frequency: "weekly",
    weeksOfMonth: [1, 3],
    startsOn: null,
  };

  it("types the slot fields as integers, matching the write side and the SMALLINT columns", () => {
    expect(scheduleSlotSchema.safeParse(slot).success).toBe(true);
    for (const patch of [
      { dayOfWeek: 1.5 },
      { startMinute: 600.5 },
      { endMinute: 660.5 },
      { weeksOfMonth: [1.5] },
    ]) {
      expect(scheduleSlotSchema.safeParse({ ...slot, ...patch }).success).toBe(false);
    }
  });
});
