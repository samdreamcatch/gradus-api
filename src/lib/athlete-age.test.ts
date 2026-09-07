import { describe, expect, it } from "bun:test";
import { canAskGradus, isMinorBirthdate } from "./athlete-age";

/** An ISO date (UTC) exactly `days` before right now. */
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const isoDateAgo = (days: number) => daysAgo(days).toISOString().slice(0, 10);

describe("canAskGradus", () => {
  it("refuses a null birthdate (unconfirmed age)", () => {
    expect(canAskGradus(null)).toBe(false);
  });

  it("refuses a missing (undefined) birthdate (unconfirmed age)", () => {
    expect(canAskGradus(undefined)).toBe(false);
  });

  it("refuses an unparseable birthdate string", () => {
    expect(canAskGradus("not-a-date")).toBe(false);
  });

  it("allows exactly 18 years old today", () => {
    const today = new Date();
    const dob = new Date(
      Date.UTC(today.getUTCFullYear() - 18, today.getUTCMonth(), today.getUTCDate()),
    );
    expect(canAskGradus(dob.toISOString().slice(0, 10))).toBe(true);
  });

  it("refuses one day before the 18th birthday", () => {
    const today = new Date();
    const dob = new Date(
      Date.UTC(today.getUTCFullYear() - 18, today.getUTCMonth(), today.getUTCDate() + 1),
    );
    expect(canAskGradus(dob.toISOString().slice(0, 10))).toBe(false);
  });

  it("allows a birthdate well over 18", () => {
    expect(canAskGradus(isoDateAgo(30 * 365))).toBe(true);
  });

  it("refuses a birthdate well under 18", () => {
    expect(canAskGradus(isoDateAgo(10 * 365))).toBe(false);
  });

  it("never contradicts isMinorBirthdate for a confirmed adult (unlike bare negation, still refuses unconfirmed ages)", () => {
    const adultDob = isoDateAgo(20 * 365);
    expect(isMinorBirthdate(adultDob)).toBe(false);
    expect(canAskGradus(adultDob)).toBe(true);
    // The gap this function closes: isMinorBirthdate(null) is also false,
    // but canAskGradus must NOT follow it to "allowed" for a missing DOB.
    expect(isMinorBirthdate(null)).toBe(false);
    expect(canAskGradus(null)).toBe(false);
  });
});
