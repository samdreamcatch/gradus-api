import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import {
  athleteScheduleInput,
  lessonSlotSchema,
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
