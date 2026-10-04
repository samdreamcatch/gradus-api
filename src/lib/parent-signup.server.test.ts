import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import {
  athleteScheduleInput,
  lessonSlotSchema,
  linkAthletesToCoach,
  optionalInviteCodeSchema,
  saveAthleteSchedule,
  validateSignupCode,
} from "./parent-signup.server";

function fakeAdmin(rows: Record<string, unknown | null>) {
  const admin = {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: async () => ({ data: rows[table] ?? null, error: null }) };
            },
          };
        },
      };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return admin as any;
}

/**
 * A chainable fake for tests that need list reads, head counts, and inserts:
 * `rows[table]` answers `maybeSingle`/`single`; `lists[table]` answers
 * awaited selects, with `count` mirroring the list length for a
 * `{ count: "exact", head: true }` query; every insert/update/delete/upsert
 * is recorded in `writes` as `method:table`, in call order.
 */
function fakeClient(
  rows: Record<string, unknown | null>,
  lists: Record<string, unknown[]> = {},
  writes: string[] = [],
) {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"]) self[m] = () => self;
    for (const m of ["insert", "update", "delete", "upsert"] as const) {
      self[m] = () => {
        writes.push(`${m}:${table}`);
        return self;
      };
    }
    self.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
    self.single = async () => ({ data: rows[table] ?? null, error: null });
    self.then = (resolve: (v: unknown) => void) =>
      resolve({ data: lists[table] ?? [], count: (lists[table] ?? []).length, error: null });
    return self;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => chain(table) } as any;
}

async function caught(run: () => Promise<unknown>): Promise<ApiError | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof ApiError ? err : null;
  }
}

describe("optionalInviteCodeSchema", () => {
  it("normalizes a code and treats blank, null, and undefined as no code", () => {
    expect(optionalInviteCodeSchema.parse(" abcdefgh ")).toBe("ABCDEFGH");
    expect(optionalInviteCodeSchema.parse("")).toBeNull();
    expect(optionalInviteCodeSchema.parse(null)).toBeNull();
    expect(optionalInviteCodeSchema.parse(undefined)).toBeNull();
    expect(() => optionalInviteCodeSchema.parse("ABC")).toThrow();
  });
});

describe("validateSignupCode", () => {
  const env = { BETA_INVITE_CODE: "betacode" } as NodeJS.ProcessEnv;

  it("accepts the beta code for either role", async () => {
    const admin = fakeAdmin({});
    expect(await validateSignupCode(admin, { code: "BETACODE", role: "parent" }, env)).toEqual({
      kind: "beta",
    });
    expect(await validateSignupCode(admin, { code: "BETACODE", role: "coach" }, env)).toEqual({
      kind: "beta",
    });
  });

  it("resolves a coach's code for a parent, and refuses it for a coach with the web's words", async () => {
    const admin = fakeAdmin({ coach_invite_codes: { coach_id: "coach-1" } });
    expect(await validateSignupCode(admin, { code: "COACHAAA", role: "parent" }, env)).toEqual({
      kind: "coach",
      coachId: "coach-1",
    });
    const refused = await caught(() =>
      validateSignupCode(admin, { code: "COACHAAA", role: "coach" }, env),
    );
    expect(refused?.status).toBe(422);
    expect(refused?.message).toBe("That beta code isn't valid.");
  });

  it("answers 404 with the web's words for an unknown code", async () => {
    const missing = await caught(() =>
      validateSignupCode(fakeAdmin({}), { code: "ZZZZZZZZ", role: "parent" }, env),
    );
    expect(missing?.status).toBe(404);
    expect(missing?.message).toBe(
      "That code isn't valid. Check with your coach, or use your Gradus beta code.",
    );
  });
});

describe("linkAthletesToCoach", () => {
  const input = {
    code: "COACHAAA",
    athletes: [{ firstName: "Greta", lastName: "G", birthdate: "2015-01-01" }],
  };

  it("refuses a full roster before creating any athlete rows", async () => {
    const writes: string[] = [];
    const admin = fakeClient(
      {
        coach_invite_codes: { coach_id: "coach-1" },
        parent_profiles: { id: "parent-1" },
        coach_profiles: { organization_id: null, subscription_tier: null },
      },
      { coach_athletes: [1, 2, 3, 4, 5] },
      writes,
    );
    await expect(linkAthletesToCoach({ userId: "u", admin }, input)).rejects.toThrow(
      /Roster full/i,
    );
    expect(writes).not.toContain("insert:athletes");
  });

  it("creates and links the athlete when there's room on the roster", async () => {
    const writes: string[] = [];
    const admin = fakeClient(
      {
        coach_invite_codes: { coach_id: "coach-1" },
        parent_profiles: { id: "parent-1" },
        coach_profiles: { organization_id: null, subscription_tier: null },
      },
      { coach_athletes: [1, 2], athletes: [{ id: "athlete-1" }] },
      writes,
    );
    expect(await linkAthletesToCoach({ userId: "u", admin }, input)).toEqual({ ok: true });
    expect(writes).toContain("insert:athletes");
    expect(writes).toContain("insert:coach_athletes");
  });
});

describe("lesson slots", () => {
  it("default to weekly with no weeks and no start date", () => {
    expect(lessonSlotSchema.parse({ dayOfWeek: 1, startMinute: 600, endMinute: 660 })).toEqual({
      dayOfWeek: 1,
      startMinute: 600,
      endMinute: 660,
      frequency: "weekly",
      weeksOfMonth: [],
      startsOn: null,
    });
  });

  it("must end after they start, checked before any lookup", async () => {
    const input = athleteScheduleInput.parse({
      code: null,
      athleteId: "8c1e2a60-1b2c-4d3e-9f00-000000000001",
      slots: [{ dayOfWeek: 2, startMinute: 600, endMinute: 600 }],
    });
    const error = await caught(() =>
      saveAthleteSchedule({ userId: "u", admin: fakeAdmin({}) }, input),
    );
    expect(error?.status).toBe(422);
    expect(error?.message).toBe("End time must be after start time.");
  });
});
