import { describe, expect, it } from "vitest";
import {
  FOUNDING_PRO_TRIAL_DAYS,
  FOUNDING_PRO_TRIAL_MONTHS,
  isFoundingCoachWindowOpen,
} from "./paywall-flag";

describe("founding coach deal", () => {
  it("is open through Nov 30, 2026 and closes Dec 1, 2026 UTC", () => {
    expect(isFoundingCoachWindowOpen(new Date("2026-11-30T23:59:59Z"))).toBe(true);
    expect(isFoundingCoachWindowOpen(new Date("2026-12-01T00:00:00Z"))).toBe(false);
  });
  it("gives 3 months of free Coach Pro", () => {
    expect(FOUNDING_PRO_TRIAL_MONTHS).toBe(3);
    expect(FOUNDING_PRO_TRIAL_DAYS).toBe(90);
  });
});
