import { describe, expect, it } from "bun:test";
import { effectiveCoachEntitlement } from "./club-access";
describe("club entitlement fallback", () => {
  const base = { entitlement: "club_covered" as const, tier: "coach" as const, foundingCoach: false, subscriptionStatus: null };
  it("does not retain club coverage after contract or seat eligibility ends", () => {
    expect(effectiveCoachEntitlement(base)).toBe("pending");
  });
  it("keeps the coach's active personal plan", () => {
    expect(effectiveCoachEntitlement({ ...base, subscriptionStatus: "active" })).toBe("paid");
  });
  it("keeps founding coach personal access", () => {
    expect(effectiveCoachEntitlement({ ...base, foundingCoach: true })).toBe("promo_free");
  });
  it("retains club coverage for an eligible seated coach", () => {
    expect(effectiveCoachEntitlement({ ...base, tier: "club" })).toBe("club_covered");
  });
});