import { describe, expect, it } from "bun:test";
import {
  checkRosterRoom,
  isRosterFullError,
  rosterFullBackstopMessage,
  rosterFullMessage,
} from "./roster-limits";

describe("checkRosterRoom", () => {
  it("blocks a basic-tier coach's 6th athlete but allows the 5th", () => {
    const coach = { organizationId: null, subscriptionTier: null as "coach" | "coach_pro" | null };
    expect(() => checkRosterRoom(coach, 4, 1)).not.toThrow();
    expect(() => checkRosterRoom(coach, 5, 1)).toThrow(
      "Roster full: the coach plan is limited to 5 athletes. Upgrade to add more.",
    );
  });

  it("caps coach_pro at 50 and never caps club", () => {
    const pro = { organizationId: null, subscriptionTier: "coach_pro" as const };
    expect(() => checkRosterRoom(pro, 49, 1)).not.toThrow();
    expect(() => checkRosterRoom(pro, 50, 1)).toThrow(/coach_pro plan is limited to 50/);

    const club = { organizationId: "org-1", subscriptionTier: null };
    expect(() => checkRosterRoom(club, 1000, 5)).not.toThrow();
  });

  it("rejects a batch that would push a coach over the cap, even if some room remains", () => {
    const coach = { organizationId: null, subscriptionTier: null };
    // 3 already on roster, cap 5: 2 new athletes fit, 3 new athletes don't.
    expect(() => checkRosterRoom(coach, 3, 2)).not.toThrow();
    expect(() => checkRosterRoom(coach, 3, 3)).toThrow(/limited to 5 athletes/);
  });

  it("is a no-op when there are zero new links (idempotent re-claims skip the check entirely)", () => {
    const coach = { organizationId: null, subscriptionTier: null };
    // Already at (or even over) the cap, but adding nothing never throws.
    expect(() => checkRosterRoom(coach, 5, 0)).not.toThrow();
    expect(() => checkRosterRoom(coach, 999, 0)).not.toThrow();
  });

  it("the thrown message is still recognized as a roster-full error", () => {
    try {
      checkRosterRoom({ organizationId: null, subscriptionTier: null }, 5, 1);
      throw new Error("expected checkRosterRoom to throw");
    } catch (err) {
      expect(isRosterFullError(err)).toBe(true);
    }
  });
});

describe("rosterFullMessage / rosterFullBackstopMessage", () => {
  it("both match isRosterFullError, and the backstop names no tier, cap, or upgrade CTA", () => {
    expect(isRosterFullError(new Error(rosterFullMessage("coach", 5)))).toBe(true);
    expect(isRosterFullError(new Error(rosterFullBackstopMessage))).toBe(true);
    expect(rosterFullBackstopMessage).not.toMatch(/coach plan|coach_pro plan|club plan/);
    expect(rosterFullBackstopMessage).not.toMatch(/\d/);
    expect(rosterFullBackstopMessage).not.toMatch(/upgrade/i);
  });
});
