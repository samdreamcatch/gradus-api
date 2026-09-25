import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import { getAthleteInviteSummary, usernameSignupInput } from "./athlete-signup.server";
import { athleteCanConnectCoach, createSelfManagedAthleteInput } from "./adult-athlete.server";

function fakeAdmin(rows: Record<string, unknown | null>, throttle = 1) {
  const chain = (table: string) => ({
    select() {
      return this;
    },
    eq() {
      return this;
    },
    limit() {
      return this;
    },
    maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
    single: async () => ({ data: rows[table] ?? null, error: null }),
    then: undefined,
  });
  const admin = {
    rpc: async () => ({ data: throttle, error: null }),
    from: (table: string) => chain(table),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return admin as any;
}

async function caught(run: () => Promise<unknown>): Promise<ApiError | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof ApiError ? err : null;
  }
}

describe("getAthleteInviteSummary", () => {
  it("throttles per IP, then rejects unknown, used, and expired codes with the web's words", async () => {
    const limited = await caught(() =>
      getAthleteInviteSummary(fakeAdmin({}, -1), "ip", "AAAAAAAA"),
    );
    expect(limited?.status).toBe(429);

    const unknown = await caught(() => getAthleteInviteSummary(fakeAdmin({}), "ip", "AAAAAAAA"));
    expect(unknown?.status).toBe(404);
    expect(unknown?.message).toBe("That code isn't valid. Double-check with your parent.");

    const used = await caught(() =>
      getAthleteInviteSummary(
        fakeAdmin({
          athlete_invite_codes: {
            athlete_id: "a",
            used_at: "2026-01-01T00:00:00Z",
            expires_at: null,
          },
        }),
        "ip",
        "AAAAAAAA",
      ),
    );
    expect(used?.status).toBe(422);
    expect(used?.message).toBe("This code has already been used.");

    const expired = await caught(() =>
      getAthleteInviteSummary(
        fakeAdmin({
          athlete_invite_codes: {
            athlete_id: "a",
            used_at: null,
            expires_at: "2020-01-01T00:00:00Z",
          },
        }),
        "ip",
        "AAAAAAAA",
      ),
    );
    expect(expired?.message).toBe("This code has expired. Ask your parent for a new one.");
  });
});

describe("usernameSignupInput", () => {
  it("lowercases the username and enforces the web's rules", () => {
    expect(
      usernameSignupInput.parse({
        code: "abcdefgh",
        username: " Skater_01 ",
        password: "12345678",
      }),
    ).toEqual({
      code: "ABCDEFGH",
      username: "skater_01",
      password: "12345678",
    });
    expect(() =>
      usernameSignupInput.parse({ code: "ABCDEFGH", username: "ab", password: "12345678" }),
    ).toThrow();
    expect(() =>
      usernameSignupInput.parse({ code: "ABCDEFGH", username: "sk8-er", password: "12345678" }),
    ).toThrow();
    expect(() =>
      usernameSignupInput.parse({ code: "ABCDEFGH", username: "skater", password: "1234567" }),
    ).toThrow();
  });
});

describe("createSelfManagedAthleteInput", () => {
  const year = new Date().getFullYear();
  it("needs a guardian email for a minor and not for an adult", () => {
    const minor = { firstName: "A", lastName: "B", birthdate: `${year - 15}-01-01` };
    expect(() => createSelfManagedAthleteInput.parse(minor)).toThrow();
    expect(
      createSelfManagedAthleteInput.parse({ ...minor, guardianEmail: " Parent@Example.com " })
        .guardianEmail,
    ).toBe("parent@example.com");
    expect(
      createSelfManagedAthleteInput.parse({
        firstName: "A",
        lastName: "B",
        birthdate: `${year - 30}-06-15`,
      }).guardianEmail,
    ).toBeUndefined();
  });

  it("rejects impossible dates", () => {
    expect(() =>
      createSelfManagedAthleteInput.parse({
        firstName: "A",
        lastName: "B",
        birthdate: "2000-02-30",
      }),
    ).toThrow();
    expect(() =>
      createSelfManagedAthleteInput.parse({
        firstName: "A",
        lastName: "B",
        birthdate: "1800-01-01",
      }),
    ).toThrow();
  });
});

describe("athleteCanConnectCoach", () => {
  const year = new Date().getFullYear();
  it("adults always can; minors need a guardian email or a linked parent", () => {
    expect(
      athleteCanConnectCoach({
        birthdate: `${year - 25}-01-01`,
        guardian_email: null,
        parent_id: null,
      }),
    ).toBe(true);
    expect(
      athleteCanConnectCoach({
        birthdate: `${year - 14}-01-01`,
        guardian_email: null,
        parent_id: null,
      }),
    ).toBe(false);
    expect(
      athleteCanConnectCoach({
        birthdate: `${year - 14}-01-01`,
        guardian_email: "p@x.com",
        parent_id: null,
      }),
    ).toBe(true);
    expect(
      athleteCanConnectCoach({
        birthdate: `${year - 14}-01-01`,
        guardian_email: null,
        parent_id: "p1",
      }),
    ).toBe(true);
    expect(athleteCanConnectCoach({ birthdate: null, guardian_email: null, parent_id: null })).toBe(
      true,
    );
  });

  it("a provisional or paused account never connects a coach (PRD §6.13 A4)", () => {
    const base = { birthdate: `${year - 14}-01-01`, guardian_email: "p@x.com", parent_id: null };
    expect(athleteCanConnectCoach({ ...base, account_state: "provisional" })).toBe(false);
    expect(athleteCanConnectCoach({ ...base, account_state: "paused" })).toBe(false);
    expect(athleteCanConnectCoach({ ...base, account_state: "active" })).toBe(true);
    expect(
      athleteCanConnectCoach({
        ...base,
        birthdate: `${year - 30}-01-01`,
        account_state: "provisional",
      }),
    ).toBe(false);
  });
});
