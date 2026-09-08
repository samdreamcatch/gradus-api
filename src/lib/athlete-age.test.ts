import { describe, expect, it } from "bun:test";
import { canAskGradus, isMinorBirthdate } from "./athlete-age";

/** An ISO date (UTC) exactly `days` before right now. */
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const isoDateAgo = (days: number) => daysAgo(days).toISOString().slice(0, 10);

/** Formats a UTC date as `YYYY-MM-DD`, matching the `birthdate` column's format. */
function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A birthdate exactly `years` years before today (UTC), optionally offset by `dayOffset` days. */
function birthdateYearsAgo(years: number, dayOffset = 0): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return ymd(d);
}

describe("isMinorBirthdate", () => {
  it("is false for null/undefined (no birthdate on file)", () => {
    expect(isMinorBirthdate(null)).toBe(false);
    expect(isMinorBirthdate(undefined)).toBe(false);
  });

  it("is false for an unparseable string", () => {
    expect(isMinorBirthdate("not-a-date")).toBe(false);
  });

  it("is false exactly on an 18th birthday (today)", () => {
    expect(isMinorBirthdate(birthdateYearsAgo(18))).toBe(false);
  });

  it("is true the day before an 18th birthday", () => {
    expect(isMinorBirthdate(birthdateYearsAgo(18, 1))).toBe(true);
  });

  it("is false the day after an 18th birthday", () => {
    expect(isMinorBirthdate(birthdateYearsAgo(18, -1))).toBe(false);
  });

  it("is true for a 10-year-old", () => {
    expect(isMinorBirthdate(birthdateYearsAgo(10))).toBe(true);
  });
});

describe("canAskGradus", () => {
  it("is false when there is no birthdate on file — age unconfirmed, refused, never assumed adult", () => {
    expect(canAskGradus(null)).toBe(false);
  });

  it("is false for an invalid birthdate string — also unconfirmed", () => {
    expect(canAskGradus("not-a-date")).toBe(false);
  });

  it("is true exactly on the 18th birthday (today)", () => {
    expect(canAskGradus(birthdateYearsAgo(18))).toBe(true);
  });

  it("is false the day before the 18th birthday", () => {
    expect(canAskGradus(birthdateYearsAgo(18, 1))).toBe(false);
  });

  it("is true the day after the 18th birthday", () => {
    expect(canAskGradus(birthdateYearsAgo(18, -1))).toBe(true);
  });

  it("is true for a well-established adult (30 years old)", () => {
    expect(canAskGradus(birthdateYearsAgo(30))).toBe(true);
  });

  it("is false for a young athlete (10 years old)", () => {
    expect(canAskGradus(birthdateYearsAgo(10))).toBe(false);
  });

  it("is false for a missing (undefined) birthdate — unconfirmed age", () => {
    expect(canAskGradus(undefined)).toBe(false);
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
