import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import { inviteCodeSchema, resolveInviteCode } from "./invites.server";

/**
 * A fake service-role client for `resolveInviteCode`: canned rows per
 * table for `.from(...).select(...).eq(...).maybeSingle()`, and a
 * scripted `rpc` for the lookup throttle.
 */
function fakeAdmin(rows: Record<string, unknown | null>, throttle = 1) {
  const calls: { table: string; column: string; value: string }[] = [];
  const admin = {
    rpc: async (_fn: string, _args: unknown) => ({ data: throttle, error: null }),
    from(table: string) {
      return {
        select() {
          return {
            eq(column: string, value: string) {
              calls.push({ table, column, value });
              return {
                maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
              };
            },
          };
        },
      };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: admin as any, calls };
}

describe("inviteCodeSchema", () => {
  it("accepts lowercase and surrounding whitespace, and normalizes to the stored form", () => {
    expect(inviteCodeSchema.parse("  ab2cd3ef ")).toBe("AB2CD3EF");
  });

  it("rejects wrong lengths and the digits the alphabet never uses", () => {
    for (const bad of ["ABCDEFG", "ABCDEFGHI", "ABCD0EFG", "ABCD1EFG", "ABC-DEFG"]) {
      expect(() => inviteCodeSchema.parse(bad)).toThrow();
    }
  });
});

describe("resolveInviteCode", () => {
  it("finds a coach code", async () => {
    const { admin } = fakeAdmin({ coach_invite_codes: { code: "AAAAAAAA" } });
    expect(await resolveInviteCode(admin, "1.2.3.4", "AAAAAAAA")).toEqual({
      kind: "coach",
      valid: true,
      promoCode: null,
    });
  });

  it("carries a parent's promo only while it is active", async () => {
    const withActive = fakeAdmin({
      parent_invite_codes: { code: "P", promo_code: "FRIEND10" },
      promo_codes: { code: "FRIEND10", active: true },
    });
    expect(await resolveInviteCode(withActive.admin, "ip", "PPPPPPPP")).toEqual({
      kind: "parent",
      valid: true,
      promoCode: "FRIEND10",
    });
    const withInactive = fakeAdmin({
      parent_invite_codes: { code: "P", promo_code: "FRIEND10" },
      promo_codes: { code: "FRIEND10", active: false },
    });
    expect((await resolveInviteCode(withInactive.admin, "ip", "PPPPPPPP")).promoCode).toBeNull();
  });

  it("marks a used or expired athlete code invalid, with the reason", async () => {
    const used = fakeAdmin({
      athlete_invite_codes: { code: "A", used_at: "2026-09-01T00:00:00Z", expires_at: null },
    });
    expect(await resolveInviteCode(used.admin, "ip", "AAAAAAA2")).toEqual({
      kind: "athlete",
      valid: false,
      used: true,
      expired: false,
      promoCode: null,
    });
    const expired = fakeAdmin({
      athlete_invite_codes: { code: "A", used_at: null, expires_at: "2020-01-01T00:00:00Z" },
    });
    expect(await resolveInviteCode(expired.admin, "ip", "AAAAAAA2")).toMatchObject({
      kind: "athlete",
      valid: false,
      expired: true,
    });
  });

  it("reports an unclaimed guardian code with its token, and a claimed one as used", async () => {
    const open = fakeAdmin({
      athletes: { guardian_claim_token: "tok", parent_id: null, guardian_claimed_at: null },
    });
    expect(await resolveInviteCode(open.admin, "ip", "GGGGGGGG")).toEqual({
      kind: "guardian",
      valid: true,
      used: false,
      guardianToken: "tok",
      promoCode: null,
    });
    const claimed = fakeAdmin({
      athletes: { guardian_claim_token: "tok", parent_id: "p1", guardian_claimed_at: null },
    });
    expect(await resolveInviteCode(claimed.admin, "ip", "GGGGGGGG")).toMatchObject({
      kind: "guardian",
      valid: false,
      used: true,
    });
  });

  it("answers null for an unknown code", async () => {
    const { admin } = fakeAdmin({});
    expect(await resolveInviteCode(admin, "ip", "ZZZZZZZZ")).toEqual({
      kind: null,
      valid: false,
      promoCode: null,
    });
  });

  it("throttles per IP as a 429 with the web's wording", async () => {
    const { admin } = fakeAdmin({}, -1);
    let caught: unknown;
    try {
      await resolveInviteCode(admin, "ip", "ZZZZZZZZ");
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof ApiError).toBe(true);
    expect((caught as ApiError).status).toBe(429);
    expect((caught as ApiError).message).toBe(
      "Too many attempts. Please wait a minute and try again.",
    );
  });
});
