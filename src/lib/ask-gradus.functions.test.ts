import { describe, expect, it } from "bun:test";
import { resolveAskGradusAudience } from "./ask-gradus.functions";

/**
 * A minimal fake for `athletes`: `select("id, birthdate").eq("user_id", …).maybeSingle()`
 * resolves to `{ data: row, error: null }`, ignoring the filter value (each
 * test only ever fakes one caller).
 */
function fakeAdmin(row: { id: string; birthdate: string | null } | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row, error: null }),
        }),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/**
 * Simulates `.maybeSingle()` returning a non-null `error` alongside null
 * `data` — what PostgREST sends back (PGRST116) when more than one row
 * matches the filter, since `.maybeSingle()` can only collapse the
 * zero-rows case to a clean `null`.
 */
function fakeAdminWithError() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: null,
            error: { code: "PGRST116", message: "multiple (or no) rows returned" },
          }),
        }),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const ADULT_DOB = daysAgo(25 * 365);
const MINOR_DOB = daysAgo(10 * 365);
const REFUSAL = "Ask Gradus isn't available for this account.";

describe("resolveAskGradusAudience", () => {
  it("no athletes row (coach, parent, or no profile) -> parent", async () => {
    const audience = await resolveAskGradusAudience("u1", fakeAdmin(null));
    expect(audience).toBe("parent");
  });

  it("an athletes row with a birthdate confirming 18+ -> athlete", async () => {
    const audience = await resolveAskGradusAudience(
      "u1",
      fakeAdmin({ id: "a1", birthdate: ADULT_DOB }),
    );
    expect(audience).toBe("athlete");
  });

  it("an athletes row with a birthdate confirming under 18 -> refused", async () => {
    await expect(
      resolveAskGradusAudience("u1", fakeAdmin({ id: "a1", birthdate: MINOR_DOB })),
    ).rejects.toThrow(REFUSAL);
  });

  it("an athletes row with no birthdate on file -> refused", async () => {
    await expect(
      resolveAskGradusAudience("u1", fakeAdmin({ id: "a1", birthdate: null })),
    ).rejects.toThrow(REFUSAL);
  });

  it("an athletes row with an unparseable birthdate -> refused", async () => {
    await expect(
      resolveAskGradusAudience("u1", fakeAdmin({ id: "a1", birthdate: "not-a-date" })),
    ).rejects.toThrow(REFUSAL);
  });

  it("a lookup error (e.g. duplicate athletes rows for this user) -> refused, not parent", async () => {
    await expect(resolveAskGradusAudience("u1", fakeAdminWithError())).rejects.toThrow(REFUSAL);
  });
});
