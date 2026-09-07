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
  updateParentProfile,
} from "./parent-settings.server";

const A = "11111111-1111-4111-8111-111111111111";
const C = "22222222-2222-4222-8222-222222222222";
const C2 = "33333333-3333-4333-8333-333333333333";
const C3 = "44444444-4444-4444-8444-444444444444";

type Answer = { data?: unknown; error?: { code?: string; message: string } | null };
/** One chained filter: `[method, column, value]`, e.g. `["eq", "athlete_id", A]` or `["in", "sport", ["hockey"]]`. */
type Filter = [method: string, column: string, value: unknown];
type WriteCall = {
  op: "insert" | "update" | "upsert" | "delete" | "updateUserById";
  table: string;
  payload?: unknown;
  /** The second argument of `upsert` (`{ onConflict }`). */
  opts?: unknown;
  filters: Filter[];
};

type FakeOptions = {
  /** `counts[table]` answers `select(..., { count, head })`. */
  counts?: Record<string, number>;
  /** Records every `delete()`/`insert()`/`upsert()`/`update()` as `method:table` in call order. */
  writes?: string[];
  /** Records every write with its payload, upsert options, and the filters chained after it. */
  calls?: WriteCall[];
  /** Per-table answers for `maybeSingle`/`single`, consumed in order before falling back to `rows[table]`. */
  queue?: Record<string, Answer[]>;
  /** What `auth.admin.updateUserById` resolves to. */
  updateUser?: { error: { message: string } | null };
};

/**
 * A chainable fake: `rows[table]` (or the `queue`) answers `maybeSingle`/`single`;
 * `lists[table]` answers awaited selects; `counts[table]` answers head counts.
 * Filters are not applied to `lists`, only recorded on writes.
 */
function fakeClient(
  rows: Record<string, unknown | null>,
  lists: Record<string, unknown[]> = {},
  opts: FakeOptions = {},
) {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    const filters: Filter[] = [];
    for (const m of ["select", "order", "limit"]) self[m] = () => self;
    for (const m of ["eq", "neq", "in", "lte", "gte", "lt"]) {
      self[m] = (column: string, value: unknown) => {
        filters.push([m, column, value]);
        return self;
      };
    }
    for (const m of ["update", "delete", "insert", "upsert"] as const) {
      self[m] = (payload?: unknown, upsertOpts?: unknown) => {
        opts.writes?.push(`${m}:${table}`);
        // `filters` is shared by reference, so `.eq()` calls chained after the
        // write land on the recorded call.
        opts.calls?.push({ op: m, table, payload, opts: upsertOpts, filters });
        return self;
      };
    }
    const single = async () => {
      const next = opts.queue?.[table]?.shift();
      if (next) return { data: next.data ?? null, error: next.error ?? null };
      return { data: rows[table] ?? null, error: null };
    };
    self.maybeSingle = single;
    self.single = single;
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
        updateUserById: async (id: string, attrs: unknown) => {
          opts.calls?.push({ op: "updateUserById", table: id, payload: attrs, filters: [] });
          return opts.updateUser ?? { error: null };
        },
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const INVITE_CODE = /^[A-HJ-NP-Z2-9]{8}$/;
const daysAgo = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const MINOR_DOB = daysAgo(10 * 365);
const ADULT_DOB = daysAgo(30 * 365);

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

  it("updateParentProfile writes both names scoped to the caller's user_id", async () => {
    const calls: WriteCall[] = [];
    const admin = fakeClient({}, {}, { calls });
    expect(
      await updateParentProfile({ userId: "u", admin }, { firstName: "Lorelai", lastName: "G" }),
    ).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        op: "update",
        table: "parent_profiles",
        payload: { first_name: "Lorelai", last_name: "G" },
        opts: undefined,
        filters: [["eq", "user_id", "u"]],
      },
    ]);
  });

  it("updateParentProfile with apiContract is 403 wrong_role for a caller without a profile, before any write", async () => {
    const calls: WriteCall[] = [];
    const err = await caught(() =>
      updateParentProfile(
        { userId: "u", admin: fakeClient({}, {}, { calls }) },
        { firstName: "L", lastName: "G" },
        { apiContract: true },
      ),
    );
    expect(err?.status).toBe(403);
    expect(err?.code).toBe("wrong_role");
    expect(err?.message).toBe("Parent profile not found.");
    expect(calls).toEqual([]);
  });

  it("updateParentProfile with apiContract still writes for a parent", async () => {
    const calls: WriteCall[] = [];
    const admin = fakeClient({ parent_profiles: parent }, {}, { calls });
    expect(
      await updateParentProfile(
        { userId: "u", admin },
        { firstName: "L", lastName: "G" },
        { apiContract: true },
      ),
    ).toEqual({ ok: true });
    expect(calls.map((c) => `${c.op}:${c.table}`)).toEqual(["update:parent_profiles"]);
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

  it("a primary row for a coach no longer scoped to the sport keeps the id with no name (web parity)", async () => {
    const admin = fakeClient(
      { parent_profiles: parent },
      {
        athletes: [{ id: A, first_name: "R", last_name: "G", parent_id: "p1" }],
        coach_athletes: [
          {
            athlete_id: A,
            coach_id: C,
            created_at: "2026-01-01",
            coach_profiles: { first_name: "Dean", last_name: "Forester" },
          },
        ],
        coach_athlete_sports: [{ athlete_id: A, coach_id: C, sport: "figure_skating" }],
        athlete_primary_coaches: [{ athlete_id: A, sport: "figure_skating", coach_id: C2 }],
        athlete_invite_codes: [{ athlete_id: A, code: "ABCDEFGH" }],
      },
    );
    const settings = await getParentSettings({ userId: "u", admin });
    expect(settings.athletes[0].sports).toEqual([
      {
        sport: "figure_skating",
        primaryCoachId: C2,
        primaryCoachName: null,
        eligibleCoaches: [{ coachId: C, coachName: "Dean Forester" }],
        goals: null,
      },
    ]);
  });
});

describe("getParentSettings invite codes", () => {
  const rory = { id: A, first_name: "Rory", last_name: "Gilmore", user_id: null, parent_id: "p1" };
  const promoParent = { ...parent, promo_code: "PROMO" };

  it("mints one for the primary parent's athlete and returns it", async () => {
    const calls: WriteCall[] = [];
    const admin = fakeClient(
      { parent_profiles: promoParent },
      { athletes: [rory] },
      { calls, queue: { athlete_invite_codes: [{ data: { code: "MINTED01" } }] } },
    );
    const settings = await getParentSettings({ userId: "u", admin });
    expect(settings.athletes[0].inviteCode).toBe("MINTED01");
    expect(calls).toEqual([
      {
        op: "insert",
        table: "athlete_invite_codes",
        payload: {
          parent_id: "p1",
          athlete_id: A,
          code: expect.stringMatching(INVITE_CODE),
          promo_code: "PROMO",
        },
        opts: undefined,
        filters: [],
      },
    ]);
  });

  it("does not mint for a co-guardian's athlete (null invite code, no insert)", async () => {
    const calls: WriteCall[] = [];
    const admin = fakeClient(
      { parent_profiles: promoParent },
      { athletes: [{ ...rory, parent_id: "other-parent" }] },
      { calls },
    );
    const settings = await getParentSettings({ userId: "u", admin });
    expect(settings.athletes[0].inviteCode).toBeNull();
    expect(calls).toEqual([]);
  });

  it("retries a colliding code and keeps the code the third insert returned", async () => {
    const calls: WriteCall[] = [];
    const collision = { error: { code: "23505", message: "duplicate key" } };
    const admin = fakeClient(
      { parent_profiles: promoParent },
      { athletes: [rory] },
      { calls, queue: { athlete_invite_codes: [collision, collision, { data: { code: "X" } }] } },
    );
    const settings = await getParentSettings({ userId: "u", admin });
    expect(settings.athletes[0].inviteCode).toBe("X");
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => (c.payload as { code: string }).code)).size).toBe(3);
  });

  it("gives up after five failed inserts and answers null", async () => {
    const calls: WriteCall[] = [];
    const collision = { error: { code: "23505", message: "duplicate key" } };
    const admin = fakeClient(
      { parent_profiles: promoParent },
      { athletes: [rory] },
      { calls, queue: { athlete_invite_codes: Array(6).fill(collision) } },
    );
    const settings = await getParentSettings({ userId: "u", admin });
    expect(settings.athletes[0].inviteCode).toBeNull();
    expect(calls).toHaveLength(5);
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

  it("normalizes weeks_of_month and starts_on per frequency on insert", async () => {
    const calls: WriteCall[] = [];
    const admin = fakeClient(
      { athletes: ownedAthlete, coach_athletes: { id: "link" } },
      {},
      { calls },
    );
    const base = { dayOfWeek: 2, startMinute: 600, endMinute: 660 };
    const data = parentScheduleInput.parse({
      coachId: C,
      slots: [
        { ...base, frequency: "weekly", weeksOfMonth: [2], startsOn: "2026-09-07" },
        { ...base, frequency: "biweekly", weeksOfMonth: [1], startsOn: "2026-09-07" },
        { ...base, frequency: "twice_monthly", weeksOfMonth: [1, 3], startsOn: "2026-09-07" },
        { ...base, frequency: "monthly", weeksOfMonth: [2], startsOn: "2026-09-07" },
      ],
    });
    await replaceParentAthleteSchedule({ userId: "u", admin }, A, data);
    const row = (frequency: string, weeks_of_month: number[], starts_on: string | null) => ({
      athlete_id: A,
      coach_id: C,
      day_of_week: 2,
      start_minute: 600,
      end_minute: 660,
      frequency,
      weeks_of_month,
      starts_on,
    });
    expect(calls[0]).toMatchObject({
      op: "delete",
      table: "athlete_lesson_slots",
      filters: [
        ["eq", "athlete_id", A],
        ["eq", "coach_id", C],
      ],
    });
    expect(calls[1]).toMatchObject({ op: "insert", table: "athlete_lesson_slots" });
    expect(calls[1].payload).toEqual([
      row("weekly", [], null),
      row("biweekly", [], "2026-09-07"),
      row("twice_monthly", [1, 3], null),
      row("monthly", [2], null),
    ]);
  });

  it("accepts twice_monthly and monthly with no weeks (web parity; a slot that recurs on no week)", () => {
    for (const frequency of ["twice_monthly", "monthly"]) {
      expect(
        parentScheduleInput.safeParse({
          coachId: C,
          slots: [{ dayOfWeek: 1, startMinute: 600, endMinute: 660, frequency, weeksOfMonth: [] }],
        }).success,
      ).toBe(true);
    }
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

  it("inserts only the added sports and deletes only the removed ones, clearing their primary rows", async () => {
    const calls: WriteCall[] = [];
    const admin = fakeClient(
      { athletes: ownedAthlete, coach_athletes: { id: "link" } },
      {
        coach_levels: [{ sport: "hockey" }, { sport: "figure_skating" }, { sport: "tennis" }],
        coach_athlete_sports: [{ sport: "hockey" }, { sport: "figure_skating" }],
      },
      { calls },
    );
    expect(
      await setParentAthleteCoachSports({ userId: "u", admin }, A, C, {
        sports: ["hockey", "tennis"],
      }),
    ).toEqual({ ok: true });
    const scoped: Filter[] = [
      ["eq", "athlete_id", A],
      ["eq", "coach_id", C],
      ["in", "sport", ["figure_skating"]],
    ];
    expect(calls).toEqual([
      {
        op: "insert",
        table: "coach_athlete_sports",
        payload: [{ athlete_id: A, coach_id: C, sport: "tennis" }],
        opts: undefined,
        filters: [],
      },
      {
        op: "delete",
        table: "coach_athlete_sports",
        payload: undefined,
        opts: undefined,
        filters: scoped,
      },
      {
        op: "delete",
        table: "athlete_primary_coaches",
        payload: undefined,
        opts: undefined,
        filters: scoped,
      },
    ]);
  });

  it("writes nothing when the chosen set equals the current set", async () => {
    const calls: WriteCall[] = [];
    const admin = fakeClient(
      { athletes: ownedAthlete, coach_athletes: { id: "link" } },
      {
        coach_levels: [{ sport: "hockey" }, { sport: "figure_skating" }],
        coach_athlete_sports: [{ sport: "hockey" }, { sport: "figure_skating" }],
      },
      { calls },
    );
    await setParentAthleteCoachSports({ userId: "u", admin }, A, C, {
      sports: ["figure_skating", "hockey", "hockey"],
    });
    expect(calls).toEqual([]);
  });
});

describe("setParentPrimaryCoach", () => {
  it("upserts the primary on (athlete, sport) and re-stamps the goal's coach", async () => {
    const calls: WriteCall[] = [];
    const admin = fakeClient({ athletes: ownedAthlete }, {}, { calls });
    expect(
      await setParentPrimaryCoach({ userId: "u", admin }, A, { sport: "hockey", coachId: C }),
    ).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        op: "upsert",
        table: "athlete_primary_coaches",
        payload: { athlete_id: A, sport: "hockey", coach_id: C },
        opts: { onConflict: "athlete_id,sport" },
        filters: [],
      },
      {
        op: "update",
        table: "athlete_goals",
        payload: { coach_id: C },
        opts: undefined,
        filters: [
          ["eq", "athlete_id", A],
          ["eq", "sport", "hockey"],
        ],
      },
    ]);
  });
});

describe("unlinkParentAthleteFromCoach", () => {
  it("deletes slots, primary, goals, then the link, each scoped to athlete and coach", async () => {
    const calls: WriteCall[] = [];
    const admin = fakeClient({ athletes: ownedAthlete }, {}, { calls });
    expect(await unlinkParentAthleteFromCoach({ userId: "u", admin }, A, C)).toEqual({ ok: true });
    expect(calls.map((c) => `${c.op}:${c.table}`)).toEqual([
      "delete:athlete_lesson_slots",
      "delete:athlete_primary_coaches",
      "delete:athlete_goals",
      "delete:coach_athletes",
    ]);
    for (const c of calls) {
      expect(c.filters).toEqual([
        ["eq", "athlete_id", A],
        ["eq", "coach_id", C],
      ]);
    }
  });
});

describe("addParentAthlete", () => {
  it("inserts the athlete under the parent, mints an invite code with the promo, and returns the id", async () => {
    const calls: WriteCall[] = [];
    const admin = fakeClient(
      { parent_profiles: { ...parent, promo_code: "PROMO" }, athletes: { id: A } },
      {},
      { calls },
    );
    expect(
      await addParentAthlete(
        { userId: "u", admin },
        { firstName: "Rory", lastName: "Gilmore", birthdate: "2014-09-08" },
      ),
    ).toEqual({ ok: true, athleteId: A });
    expect(calls).toEqual([
      {
        op: "insert",
        table: "athletes",
        payload: {
          parent_id: "p1",
          first_name: "Rory",
          last_name: "Gilmore",
          birthdate: "2014-09-08",
        },
        opts: undefined,
        filters: [],
      },
      {
        op: "insert",
        table: "athlete_invite_codes",
        payload: {
          parent_id: "p1",
          athlete_id: A,
          code: expect.stringMatching(INVITE_CODE),
          promo_code: "PROMO",
        },
        opts: undefined,
        filters: [],
      },
    ]);
  });
});

describe("setParentAthleteGoals", () => {
  // Hockey has no starter programs, so the post-upsert seeding resolves to
  // nothing and never reaches a real client.
  const goals = { sport: "hockey", currentLevelKey: "l1", seasonGoalKey: "g1", longTermGoal: "Go" };
  const goalRow = (coach_id: string) => ({
    athlete_id: A,
    coach_id,
    sport: "hockey",
    current_level_key: "l1",
    season_goal_key: "g1",
    long_term_goal: "Go",
  });

  it("stamps the existing primary coach on the upsert (athlete_id,sport), inserting no primary", async () => {
    const calls: WriteCall[] = [];
    const admin = fakeClient(
      { athletes: ownedAthlete, athlete_primary_coaches: { coach_id: C } },
      {},
      { calls },
    );
    expect(await setParentAthleteGoals({ userId: "u", admin }, A, goals)).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        op: "upsert",
        table: "athlete_goals",
        payload: goalRow(C),
        opts: { onConflict: "athlete_id,sport" },
        filters: [],
      },
    ]);
  });

  it("auto-picks the earliest-linked coach who teaches the sport as primary", async () => {
    const calls: WriteCall[] = [];
    const admin = fakeClient(
      { athletes: ownedAthlete },
      {
        coach_athletes: [
          { coach_id: C2, created_at: "2026-01-01" },
          { coach_id: C, created_at: "2026-02-01" },
        ],
        coach_levels: [{ coach_id: C }],
      },
      { calls, queue: { athlete_primary_coaches: [{ data: null }, { data: { coach_id: C } }] } },
    );
    expect(await setParentAthleteGoals({ userId: "u", admin }, A, goals)).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        op: "insert",
        table: "athlete_primary_coaches",
        payload: { athlete_id: A, sport: "hockey", coach_id: C },
        opts: undefined,
        filters: [],
      },
      {
        op: "upsert",
        table: "athlete_goals",
        payload: goalRow(C),
        opts: { onConflict: "athlete_id,sport" },
        filters: [],
      },
    ]);
  });

  it("re-reads the primary when the insert loses a race", async () => {
    const calls: WriteCall[] = [];
    const admin = fakeClient(
      { athletes: ownedAthlete },
      {
        coach_athletes: [{ coach_id: C, created_at: "2026-01-01" }],
        coach_levels: [{ coach_id: C }],
      },
      {
        calls,
        queue: {
          athlete_primary_coaches: [
            { data: null },
            { error: { code: "23505", message: "duplicate key" } },
            { data: { coach_id: C3 } },
          ],
        },
      },
    );
    expect(await setParentAthleteGoals({ userId: "u", admin }, A, goals)).toEqual({ ok: true });
    expect(calls[1]).toMatchObject({ op: "upsert", table: "athlete_goals", payload: goalRow(C3) });
  });

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
  const withAccount = { ...ownedAthlete, user_id: "user-rory", username: "rory" };
  const reset = (athlete: Record<string, unknown>) => {
    const calls: WriteCall[] = [];
    const admin = fakeClient({ athletes: athlete }, {}, { calls });
    return {
      calls,
      run: () => resetParentAthletePassword({ userId: "u", admin }, A, { password: "longenough" }),
    };
  };

  it("an athlete without an account is 422", async () => {
    const err = await caught(
      reset({
        ...withAccount,
        user_id: null,
        username: null,
        birthdate: MINOR_DOB,
        self_managed: false,
      }).run,
    );
    expect(err?.status).toBe(422);
    expect(err?.message).toBe("This athlete hasn't created their account yet.");
  });

  it("a GoTrue failure surfaces its message as 422", async () => {
    const admin = fakeClient(
      { athletes: { ...withAccount, birthdate: MINOR_DOB, self_managed: false } },
      {},
      { updateUser: { error: { message: "Password is too weak" } } },
    );
    const err = await caught(() =>
      resetParentAthletePassword({ userId: "u", admin }, A, { password: "longenough" }),
    );
    expect(err?.status).toBe(422);
    expect(err?.message).toBe("Password is too weak");
  });

  it("resets a parent-managed minor's password and returns the username", async () => {
    const { calls, run } = reset({ ...withAccount, birthdate: MINOR_DOB, self_managed: false });
    expect(await run()).toEqual({ ok: true, username: "rory" });
    expect(calls).toEqual([
      {
        op: "updateUserById",
        table: "user-rory",
        payload: { password: "longenough" },
        filters: [],
      },
    ]);
  });

  it("refuses an adult self-managed athlete with a claimed guardian (403 forbidden, no password change)", async () => {
    const { calls, run } = reset({ ...withAccount, birthdate: ADULT_DOB, self_managed: true });
    const err = await caught(run);
    expect(err?.status).toBe(403);
    expect(err?.code).toBe("forbidden");
    expect(err?.message).toBe("Only a minor athlete's password can be reset from here.");
    expect(calls).toEqual([]);
  });

  it("refuses a self-managed minor too", async () => {
    const { calls, run } = reset({ ...withAccount, birthdate: MINOR_DOB, self_managed: true });
    expect((await caught(run))?.code).toBe("forbidden");
    expect(calls).toEqual([]);
  });

  it("refuses a parent-managed athlete who has turned 18 (Mariah's call, 2026-09-07)", async () => {
    const { calls, run } = reset({ ...withAccount, birthdate: ADULT_DOB, self_managed: false });
    const err = await caught(run);
    expect(err?.code).toBe("forbidden");
    expect(calls).toEqual([]);
  });

  it("refuses an athlete with no birthdate on file — age can't be confirmed", async () => {
    const { calls, run } = reset({ ...withAccount, birthdate: null, self_managed: false });
    expect((await caught(run))?.code).toBe("forbidden");
    expect(calls).toEqual([]);
  });

  it("still answers 404 for another parent's adult athlete (ownership first)", async () => {
    const { run } = reset({
      ...foreignAthlete,
      user_id: "x",
      birthdate: ADULT_DOB,
      self_managed: true,
    });
    expect((await caught(run))?.status).toBe(404);
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
