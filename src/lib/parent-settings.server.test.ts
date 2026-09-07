import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import {
  addParentAthlete,
  athletePasswordInput,
  coachSportsInput,
  getParentSettings,
  linkCoachInput,
  linkParentAthleteToCoach,
  newParentAthleteInput,
  parentAthleteGoalsInput,
  parentAthleteInput,
  parentProfileInput,
  parentScheduleInput,
  previewCoachByInviteCode,
  primaryCoachInput,
  removeParentAthlete,
  replaceParentAthleteSchedule,
  resetParentAthletePassword,
  setParentAthleteCoachSports,
  setParentAthleteGoals,
  setParentPrimaryCoach,
  unlinkParentAthleteFromCoach,
  updateParentAthlete,
} from "./parent-settings.server";

const A = "11111111-1111-4111-8111-111111111111";
const C = "22222222-2222-4222-8222-222222222222";

type FakeOptions = {
  /** `counts[table]` answers `select(..., { count, head })`. */
  counts?: Record<string, number>;
  /** Records every `delete()`/`insert()`/`upsert()` in call order. */
  writes?: string[];
  /** What `auth.admin.updateUserById` resolves to. */
  updateUser?: { error: { message: string } | null };
};

/**
 * A chainable fake: `rows[table]` answers `maybeSingle`/`single`;
 * `lists[table]` answers awaited selects; `counts[table]` answers head counts.
 */
function fakeClient(
  rows: Record<string, unknown | null>,
  lists: Record<string, unknown[]> = {},
  opts: FakeOptions = {},
) {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "lte", "gte", "lt", "order", "limit"]) {
      self[m] = () => self;
    }
    for (const m of ["update", "delete", "insert", "upsert"]) {
      self[m] = () => {
        opts.writes?.push(`${m}:${table}`);
        return self;
      };
    }
    self.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
    self.single = async () => ({ data: rows[table] ?? null, error: null });
    self.then = (resolve: (v: unknown) => void) =>
      resolve({
        data: lists[table] ?? [],
        error: null,
        count: opts.counts?.[table] ?? null,
      });
    return self;
  };
  return {
    from: (table: string) => chain(table),
    auth: {
      admin: {
        updateUserById: async () => opts.updateUser ?? { error: null },
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

async function caught(run: () => Promise<unknown>): Promise<ApiError | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof ApiError ? err : null;
  }
}

const ownedAthlete = { id: A, parent_profiles: { user_id: "u" } };
const foreignAthlete = { id: A, parent_profiles: { user_id: "someone-else" } };
const parent = { id: "p1", first_name: "Lorelai", last_name: "Gilmore", promo_code: null };

describe("athlete ownership", () => {
  it("another parent's athlete is 'Athlete not found.' (404) for every athlete-scoped write", async () => {
    const ctx = { userId: "u", admin: fakeClient({ athletes: foreignAthlete }) };
    const slots = { coachId: C, slots: [] };
    for (const run of [
      () => updateParentAthlete(ctx, A, { firstName: "R", lastName: "G", birthdate: null }),
      () => removeParentAthlete(ctx, A),
      () =>
        setParentAthleteGoals(ctx, A, {
          sport: "figure_skating",
          currentLevelKey: "l1",
          seasonGoalKey: "g1",
          longTermGoal: "",
        }),
      () => resetParentAthletePassword(ctx, A, { password: "longenough" }),
      () => linkParentAthleteToCoach(ctx, A, { code: "ABCDEFGH", sports: ["figure_skating"] }),
      () => unlinkParentAthleteFromCoach(ctx, A, C),
      () => setParentAthleteCoachSports(ctx, A, C, { sports: ["figure_skating"] }),
      () => setParentPrimaryCoach(ctx, A, { sport: "figure_skating", coachId: C }),
      () => replaceParentAthleteSchedule(ctx, A, slots),
    ]) {
      const err = await caught(run);
      expect(err?.status).toBe(404);
      expect(err?.code).toBe("not_found");
      expect(err?.message).toBe("Athlete not found.");
    }
  });

  it("a missing athlete row is 404 too", async () => {
    const err = await caught(() =>
      unlinkParentAthleteFromCoach({ userId: "u", admin: fakeClient({}) }, A, C),
    );
    expect(err?.status).toBe(404);
  });
});

describe("parent profile", () => {
  it("a user without a parent profile is 'Parent profile not found.' (403 wrong_role)", async () => {
    const ctx = { userId: "u", admin: fakeClient({}) };
    for (const run of [
      () => getParentSettings(ctx),
      () => addParentAthlete(ctx, { firstName: "R", lastName: "G", birthdate: "2014-09-08" }),
    ]) {
      const err = await caught(run);
      expect(err?.status).toBe(403);
      expect(err?.code).toBe("wrong_role");
      expect(err?.message).toBe("Parent profile not found.");
    }
  });

  it("getParentSettings returns the profile and an empty athlete list", async () => {
    const admin = fakeClient({ parent_profiles: parent });
    const settings = await getParentSettings({ userId: "u", admin });
    expect(settings).toEqual({
      profile: { firstName: "Lorelai", lastName: "Gilmore" },
      athletes: [],
    });
  });

  it("getParentSettings assembles coaches, sports, goals, and per-coach schedules", async () => {
    const admin = fakeClient(
      { parent_profiles: parent },
      {
        athletes: [
          {
            id: A,
            first_name: "Rory",
            last_name: "Gilmore",
            birthdate: "2014-09-08",
            username: "rory",
            user_id: "user-rory",
            parent_id: "p1",
          },
        ],
        coach_athletes: [
          {
            athlete_id: A,
            coach_id: C,
            created_at: "2026-01-01",
            coach_profiles: { first_name: "Dean", last_name: "Forester" },
          },
        ],
        coach_athlete_sports: [{ athlete_id: A, coach_id: C, sport: "figure_skating" }],
        athlete_goals: [
          {
            athlete_id: A,
            sport: "figure_skating",
            current_level_key: "l1",
            season_goal_key: "g1",
            long_term_goal: null,
            coach_id: C,
          },
        ],
        athlete_lesson_slots: [
          {
            id: "s1",
            athlete_id: A,
            coach_id: C,
            day_of_week: 1,
            start_minute: 600,
            end_minute: 660,
            frequency: "weekly",
            weeks_of_month: null,
            starts_on: null,
          },
        ],
        athlete_invite_codes: [{ athlete_id: A, code: "ABCDEFGH" }],
      },
    );
    const settings = await getParentSettings({ userId: "u", admin });
    expect(settings.athletes).toEqual([
      {
        id: A,
        firstName: "Rory",
        lastName: "Gilmore",
        birthdate: "2014-09-08",
        username: "rory",
        hasAccount: true,
        inviteCode: "ABCDEFGH",
        coaches: [{ coachId: C, coachName: "Dean Forester", sports: ["figure_skating"] }],
        sports: [
          {
            sport: "figure_skating",
            primaryCoachId: C,
            primaryCoachName: "Dean Forester",
            eligibleCoaches: [{ coachId: C, coachName: "Dean Forester" }],
            goals: { currentLevelKey: "l1", seasonGoalKey: "g1", longTermGoal: "" },
          },
        ],
        schedulesByCoach: [
          {
            coachId: C,
            coachName: "Dean Forester",
            slots: [
              {
                dayOfWeek: 1,
                startMinute: 600,
                endMinute: 660,
                frequency: "weekly",
                weeksOfMonth: [],
                startsOn: null,
              },
            ],
          },
        ],
      },
    ]);
  });
});

describe("removeParentAthlete", () => {
  it("refuses to remove the only athlete (422), before any delete", async () => {
    const writes: string[] = [];
    const admin = fakeClient(
      { athletes: ownedAthlete, parent_profiles: parent },
      {},
      { counts: { athletes: 1 }, writes },
    );
    const err = await caught(() => removeParentAthlete({ userId: "u", admin }, A));
    expect(err?.status).toBe(422);
    expect(err?.message).toBe("You need at least one athlete on your account.");
    expect(writes).toEqual([]);
  });

  it("deletes dependents before the athlete when another athlete remains", async () => {
    const writes: string[] = [];
    const admin = fakeClient(
      { athletes: ownedAthlete, parent_profiles: parent },
      {},
      { counts: { athletes: 2 }, writes },
    );
    expect(await removeParentAthlete({ userId: "u", admin }, A)).toEqual({ ok: true });
    expect(writes).toEqual([
      "delete:athlete_lesson_slots",
      "delete:athlete_goals",
      "delete:athlete_primary_coaches",
      "delete:athlete_invite_codes",
      "delete:coach_athletes",
      "delete:athletes",
    ]);
  });
});

describe("replaceParentAthleteSchedule", () => {
  it("a slot ending at or before its start is 422, before any delete", async () => {
    const writes: string[] = [];
    const admin = fakeClient(
      { athletes: ownedAthlete, coach_athletes: { id: "link" } },
      {},
      { writes },
    );
    const err = await caught(() =>
      replaceParentAthleteSchedule({ userId: "u", admin }, A, {
        coachId: C,
        slots: [
          {
            dayOfWeek: 1,
            startMinute: 660,
            endMinute: 600,
            frequency: "weekly",
            weeksOfMonth: [],
            startsOn: null,
          },
        ],
      }),
    );
    expect(err?.status).toBe(422);
    expect(err?.message).toBe("End time must be after start time.");
    expect(writes).toEqual([]);
  });

  it("a coach who is not linked is 404", async () => {
    const admin = fakeClient({ athletes: ownedAthlete });
    const err = await caught(() =>
      replaceParentAthleteSchedule({ userId: "u", admin }, A, { coachId: C, slots: [] }),
    );
    expect(err?.status).toBe(404);
    expect(err?.message).toBe("That coach isn't linked to this athlete.");
  });

  it("replaces the coach's slots: delete then insert", async () => {
    const writes: string[] = [];
    const admin = fakeClient(
      { athletes: ownedAthlete, coach_athletes: { id: "link" } },
      {},
      { writes },
    );
    const slots = parentScheduleInput.parse({
      coachId: C,
      slots: [{ dayOfWeek: 1, startMinute: 600, endMinute: 660 }],
    });
    expect(await replaceParentAthleteSchedule({ userId: "u", admin }, A, slots)).toEqual({
      ok: true,
    });
    expect(writes).toEqual(["delete:athlete_lesson_slots", "insert:athlete_lesson_slots"]);
  });
});

describe("linkParentAthleteToCoach", () => {
  it("an unknown invite code is 404", async () => {
    const admin = fakeClient({ athletes: ownedAthlete });
    const err = await caught(() =>
      linkParentAthleteToCoach({ userId: "u", admin }, A, {
        code: "ABCDEFGH",
        sports: ["figure_skating"],
      }),
    );
    expect(err?.status).toBe(404);
    expect(err?.message).toBe("That invite code isn't valid. Double-check with the coach.");
  });

  it("a sport the coach does not offer is 422", async () => {
    const admin = fakeClient(
      { athletes: ownedAthlete, coach_invite_codes: { coach_id: C } },
      { coach_levels: [{ sport: "hockey" }] },
    );
    const err = await caught(() =>
      linkParentAthleteToCoach({ userId: "u", admin }, A, {
        code: "ABCDEFGH",
        sports: ["figure_skating"],
      }),
    );
    expect(err?.status).toBe(422);
    expect(err?.message).toBe("Coach doesn't offer figure_skating.");
  });

  it("an existing link is 409 already_linked", async () => {
    const admin = fakeClient(
      {
        athletes: ownedAthlete,
        coach_invite_codes: { coach_id: C },
        coach_athletes: { id: "link" },
      },
      { coach_levels: [{ sport: "figure_skating" }] },
    );
    const err = await caught(() =>
      linkParentAthleteToCoach({ userId: "u", admin }, A, {
        code: "ABCDEFGH",
        sports: ["figure_skating"],
      }),
    );
    expect(err?.status).toBe(409);
    expect(err?.code).toBe("already_linked");
    expect(err?.message).toBe("That coach is already linked to this athlete.");
  });

  it("links and scopes the chosen sports", async () => {
    const writes: string[] = [];
    const admin = fakeClient(
      { athletes: ownedAthlete, coach_invite_codes: { coach_id: C } },
      { coach_levels: [{ sport: "figure_skating" }] },
      { writes },
    );
    expect(
      await linkParentAthleteToCoach({ userId: "u", admin }, A, {
        code: "ABCDEFGH",
        sports: ["figure_skating"],
      }),
    ).toEqual({ ok: true });
    expect(writes).toEqual(["insert:coach_athletes", "insert:coach_athlete_sports"]);
  });
});

describe("previewCoachByInviteCode", () => {
  it("an unknown code is 404", async () => {
    const err = await caught(() => previewCoachByInviteCode({ admin: fakeClient({}) }, "ABCDEFGH"));
    expect(err?.status).toBe(404);
    expect(err?.message).toBe("That invite code isn't valid. Double-check with the coach.");
  });

  it("returns the coach's name and distinct sports", async () => {
    const admin = fakeClient(
      {
        coach_invite_codes: { coach_id: C },
        coach_profiles: { first_name: "Dean", last_name: "F" },
      },
      { coach_levels: [{ sport: "hockey" }, { sport: "hockey" }, { sport: "figure_skating" }] },
    );
    expect(await previewCoachByInviteCode({ admin }, "ABCDEFGH")).toEqual({
      coachId: C,
      coachName: "Dean F",
      sports: ["hockey", "figure_skating"],
    });
  });
});

describe("setParentAthleteCoachSports", () => {
  it("a coach who is not linked is 404", async () => {
    const admin = fakeClient({ athletes: ownedAthlete });
    const err = await caught(() =>
      setParentAthleteCoachSports({ userId: "u", admin }, A, C, { sports: ["hockey"] }),
    );
    expect(err?.status).toBe(404);
    expect(err?.message).toBe("That coach isn't linked to this athlete.");
  });

  it("a sport the coach does not offer is 422", async () => {
    const admin = fakeClient(
      { athletes: ownedAthlete, coach_athletes: { id: "link" } },
      { coach_levels: [{ sport: "hockey" }] },
    );
    const err = await caught(() =>
      setParentAthleteCoachSports({ userId: "u", admin }, A, C, { sports: ["figure_skating"] }),
    );
    expect(err?.status).toBe(422);
    expect(err?.message).toBe("Coach doesn't offer figure_skating.");
  });
});

describe("setParentAthleteGoals", () => {
  it("needs a linked coach who teaches the sport (422)", async () => {
    const admin = fakeClient({ athletes: ownedAthlete });
    const err = await caught(() =>
      setParentAthleteGoals({ userId: "u", admin }, A, {
        sport: "figure_skating",
        currentLevelKey: "l1",
        seasonGoalKey: "g1",
        longTermGoal: "",
      }),
    );
    expect(err?.status).toBe(422);
    expect(err?.message).toBe("Link a coach who teaches this sport before setting goals.");
  });
});

describe("resetParentAthletePassword", () => {
  it("an athlete without an account is 422", async () => {
    const admin = fakeClient({ athletes: { ...ownedAthlete, user_id: null, username: null } });
    const err = await caught(() =>
      resetParentAthletePassword({ userId: "u", admin }, A, { password: "longenough" }),
    );
    expect(err?.status).toBe(422);
    expect(err?.message).toBe("This athlete hasn't created their account yet.");
  });

  it("a GoTrue failure surfaces its message as 422", async () => {
    const admin = fakeClient(
      { athletes: { ...ownedAthlete, user_id: "user-rory", username: "rory" } },
      {},
      { updateUser: { error: { message: "Password is too weak" } } },
    );
    const err = await caught(() =>
      resetParentAthletePassword({ userId: "u", admin }, A, { password: "longenough" }),
    );
    expect(err?.status).toBe(422);
    expect(err?.message).toBe("Password is too weak");
  });

  it("returns the athlete's username on success", async () => {
    const admin = fakeClient({
      athletes: { ...ownedAthlete, user_id: "user-rory", username: "rory" },
    });
    expect(
      await resetParentAthletePassword({ userId: "u", admin }, A, { password: "longenough" }),
    ).toEqual({ ok: true, username: "rory" });
  });
});

describe("input schemas", () => {
  const issue = (r: { success: boolean; error?: { issues: Array<{ message: string }> } }) =>
    r.success ? null : r.error?.issues[0]?.message;

  it("parentProfileInput trims and requires both names", () => {
    expect(parentProfileInput.parse({ firstName: " A ", lastName: " B " })).toEqual({
      firstName: "A",
      lastName: "B",
    });
    expect(parentProfileInput.safeParse({ firstName: "", lastName: "B" }).success).toBe(false);
  });

  it("newParentAthleteInput requires a YYYY-MM-DD birthdate", () => {
    expect(
      newParentAthleteInput.safeParse({ firstName: "R", lastName: "G", birthdate: "2014-09-08" })
        .success,
    ).toBe(true);
    expect(
      newParentAthleteInput.safeParse({ firstName: "R", lastName: "G", birthdate: null }).success,
    ).toBe(false);
  });

  it("parentAthleteInput allows a null birthdate but rejects a malformed one", () => {
    expect(
      parentAthleteInput.safeParse({ firstName: "R", lastName: "G", birthdate: null }).success,
    ).toBe(true);
    expect(
      issue(parentAthleteInput.safeParse({ firstName: "R", lastName: "G", birthdate: "9/8/14" })),
    ).toBe("Birthdate required (YYYY-MM-DD)");
  });

  it("parentAthleteGoalsInput defaults longTermGoal to an empty string", () => {
    expect(
      parentAthleteGoalsInput.parse({ sport: "s", currentLevelKey: "l", seasonGoalKey: "g" })
        .longTermGoal,
    ).toBe("");
  });

  it("athletePasswordInput needs 8 characters", () => {
    expect(issue(athletePasswordInput.safeParse({ password: "short" }))).toBe(
      "Password must be at least 8 characters",
    );
  });

  it("linkCoachInput normalizes the code and needs at least one sport", () => {
    expect(linkCoachInput.parse({ code: " abcdefgh ", sports: ["s"] }).code).toBe("ABCDEFGH");
    expect(issue(linkCoachInput.safeParse({ code: "ABC", sports: ["s"] }))).toBe(
      "Invite code must be 8 characters",
    );
    expect(issue(linkCoachInput.safeParse({ code: "ABCDEFG1", sports: ["s"] }))).toBe(
      "Invalid characters in code",
    );
    expect(issue(linkCoachInput.safeParse({ code: "ABCDEFGH", sports: [] }))).toBe(
      "Pick at least one sport",
    );
  });

  it("coachSportsInput needs at least one sport and at most 20", () => {
    expect(issue(coachSportsInput.safeParse({ sports: [] }))).toBe("Pick at least one sport");
    expect(coachSportsInput.safeParse({ sports: Array(21).fill("s") }).success).toBe(false);
  });

  it("primaryCoachInput needs a uuid coach", () => {
    expect(primaryCoachInput.safeParse({ sport: "s", coachId: "nope" }).success).toBe(false);
    expect(primaryCoachInput.safeParse({ sport: "s", coachId: C }).success).toBe(true);
  });

  it("parentScheduleInput caps slots at 20 and applies slot defaults", () => {
    const parsed = parentScheduleInput.parse({
      coachId: C,
      slots: [{ dayOfWeek: 1, startMinute: 600, endMinute: 660 }],
    });
    expect(parsed.slots[0]).toEqual({
      dayOfWeek: 1,
      startMinute: 600,
      endMinute: 660,
      frequency: "weekly",
      weeksOfMonth: [],
      startsOn: null,
    });
    expect(
      parentScheduleInput.safeParse({
        coachId: C,
        slots: Array(21).fill({ dayOfWeek: 1, startMinute: 600, endMinute: 660 }),
      }).success,
    ).toBe(false);
  });
});
