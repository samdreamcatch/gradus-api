import { describe, expect, it } from "bun:test";
import { DELETED_PLAN_DAYS, purgeAtField, purgeAtOf } from "./plan-deletion";

describe("when a deleted plan is removed", () => {
  it("is thirty days after it was deleted", () => {
    expect(DELETED_PLAN_DAYS).toBe(30);
    expect(purgeAtOf("2026-11-11T09:00:00.000Z")).toBe("2026-12-11T09:00:00.000Z");
  });

  it("accepts the database's own timestamp format", () => {
    expect(purgeAtOf("2026-11-11T09:00:00+00:00")).toBe("2026-12-11T09:00:00.000Z");
  });

  it("says nothing for a plan that is not deleted", () => {
    expect(purgeAtOf(null)).toBeUndefined();
    expect(purgeAtOf(undefined)).toBeUndefined();
    expect(purgeAtOf("not a date")).toBeUndefined();
    expect(purgeAtField(null)).toEqual({});
    expect("purgeAt" in purgeAtField(null)).toBe(false);
  });

  it("spreads into a response when there is a date", () => {
    expect(purgeAtField("2026-11-11T09:00:00.000Z")).toEqual({
      purgeAt: "2026-12-11T09:00:00.000Z",
    });
  });
});
