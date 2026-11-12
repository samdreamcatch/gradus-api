import { describe, expect, it } from "bun:test";
import { clubSetupSteps } from "./club-setup";

describe("club first-run readiness", () => {
  it("starts an empty club with every task incomplete", () => {
    expect(clubSetupSteps({ coaches: 0, lessons: 0, publishedResources: 0, policyRequirements: 0 }).map(s => s.done)).toEqual([false, false, false, false]);
  });
  it("does not count a schedule review or an unpublished resource as complete", () => {
    expect(clubSetupSteps({ coaches: 1, lessons: 0, publishedResources: 0, policyRequirements: 1 }).map(s => s.done)).toEqual([true, false, false, true]);
  });
  it("completes setup only from actual club records", () => {
    expect(clubSetupSteps({ coaches: 1, lessons: 1, publishedResources: 1, policyRequirements: 1 }).every(s => s.done)).toBe(true);
  });
});