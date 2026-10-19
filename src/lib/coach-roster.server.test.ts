import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import {
  addAthleteInput,
  addAthleteWithGuardian,
  addLessonSlotInput,
  cancelLessonOccurrence,
  deleteLessonSlot,
  rosterCanMessage,
  rosterClaimStatus,
  slotTimesInput,
  updateLessonSlot,
} from "./coach-roster.server";
import { getPendingLessonWrapUps, pendingWrapUpsInput } from "./lesson-wrap-ups.server";

/** A chainable fake: `rows[table]` answers `maybeSingle`/`single`; `lists[table]` answers awaited selects. */
function fakeClient(rows: Record<string, unknown | null>, lists: Record<string, unknown[]> = {}) {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    for (const m of [
      "select",
      "eq",
      "neq",
      "in",
      "lte",
      "gte",
      "lt",
      "order",
      "limit",
      "update",
      "delete",
      "insert",
      "upsert",
    ]) {
      self[m] = () => self;
    }
    self.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
    self.single = async () => ({ data: rows[table] ?? null, error: null });
    // Awaiting the chain itself (list reads and writes) resolves to the list.
    // `count` mirrors the list length so a `{ count: "exact", head: true }`
    // query reads the same size a full-row select would have.
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

describe("lesson slot inputs", () => {
  it("require start before end and a weekday 0–6", () => {
    expect(
      slotTimesInput.safeParse({ dayOfWeek: 1, startMinute: 600, endMinute: 660 }).success,
    ).toBe(true);
    expect(
      slotTimesInput.safeParse({ dayOfWeek: 1, startMinute: 660, endMinute: 600 }).success,
    ).toBe(false);
    expect(
      slotTimesInput.safeParse({ dayOfWeek: 7, startMinute: 600, endMinute: 660 }).success,
    ).toBe(false);
    expect(
      addLessonSlotInput.safeParse({
        athleteId: "not-a-uuid",
        dayOfWeek: 1,
        startMinute: 1,
        endMinute: 2,
      }).success,
    ).toBe(false);
  });

  it("defaults to weekly with no weeks-of-month and no anchor date when cadence is omitted", () => {
    const parsed = slotTimesInput.parse({ dayOfWeek: 1, startMinute: 600, endMinute: 660 });
    expect(parsed.frequency).toBe("weekly");
    expect(parsed.weeksOfMonth).toEqual([]);
    expect(parsed.startsOn).toBeNull();
  });

  it("accepts biweekly, twice-monthly, and monthly with their required extra fields", () => {
    expect(
      slotTimesInput.safeParse({
        dayOfWeek: 1,
        startMinute: 600,
        endMinute: 660,
        frequency: "biweekly",
        startsOn: "2026-09-07",
      }).success,
    ).toBe(true);
    expect(
      slotTimesInput.safeParse({
        dayOfWeek: 1,
        startMinute: 600,
        endMinute: 660,
        frequency: "twice_monthly",
        weeksOfMonth: [1, 3],
      }).success,
    ).toBe(true);
    expect(
      slotTimesInput.safeParse({
        dayOfWeek: 1,
        startMinute: 600,
        endMinute: 660,
        frequency: "monthly",
        weeksOfMonth: [2],
      }).success,
    ).toBe(true);
  });

  it("rejects a cadence missing its required extra fields (the schedule-editor's own validateSlots rules, now enforced server-side)", () => {
    expect(
      slotTimesInput.safeParse({
        dayOfWeek: 1,
        startMinute: 600,
        endMinute: 660,
        frequency: "biweekly",
      }).success,
    ).toBe(false);
    expect(
      slotTimesInput.safeParse({
        dayOfWeek: 1,
        startMinute: 600,
        endMinute: 660,
        frequency: "twice_monthly",
        weeksOfMonth: [1],
      }).success,
    ).toBe(false);
    expect(
      slotTimesInput.safeParse({
        dayOfWeek: 1,
        startMinute: 600,
        endMinute: 660,
        frequency: "twice_monthly",
        weeksOfMonth: [1, 2, 3],
      }).success,
    ).toBe(false);
    expect(
      slotTimesInput.safeParse({
        dayOfWeek: 1,
        startMinute: 600,
        endMinute: 660,
        frequency: "monthly",
        weeksOfMonth: [],
      }).success,
    ).toBe(false);
  });
});

describe("slot ownership", () => {
  const coach = { coach_profiles: { id: "coach-1" } };
  const foreignSlot = {
    ...coach,
    athlete_lesson_slots: {
      athlete_id: "a",
      coach_id: "coach-2",
      day_of_week: 1,
      start_minute: 1,
      end_minute: 2,
    },
  };

  it("another coach's slot is 'Lesson not found' (404) for update, delete, and overrides", async () => {
    const ctx = { userId: "u", admin: fakeClient(foreignSlot) };
    const times = {
      dayOfWeek: 2,
      startMinute: 600,
      endMinute: 660,
      frequency: "weekly" as const,
      weeksOfMonth: [] as number[],
      startsOn: null,
    };
    for (const run of [
      () => updateLessonSlot(ctx, "slot-1", times),
      () => deleteLessonSlot(ctx, "slot-1"),
      () => cancelLessonOccurrence(ctx, "slot-1", "2026-09-08"),
    ]) {
      const err = await caught(run);
      expect(err?.status).toBe(404);
      expect(err?.message).toBe("Lesson not found");
    }
  });

  it("a user without a coach profile is refused", async () => {
    const err = await caught(() =>
      deleteLessonSlot({ userId: "u", admin: fakeClient({}) }, "slot-1"),
    );
    expect(err?.status).toBe(422);
    expect(err?.message).toBe("Coach profile not found");
  });
});

describe("addAthleteWithGuardian", () => {
  it("a minor needs a guardian email, before any row is written", async () => {
    const data = addAthleteInput.parse({
      firstName: "Rory",
      lastName: "Gilmore",
      birthdate: "2014-09-08",
    });
    const err = await caught(() =>
      addAthleteWithGuardian(
        { userId: "u", admin: fakeClient({ coach_profiles: { id: "coach-1" } }) },
        data,
        new Date("2026-09-06T12:00:00Z"),
      ),
    );
    expect(err?.status).toBe(422);
    expect(err?.message).toBe("Athletes under 18 need a parent or guardian email.");
  });

  it("invites the parent, never the athlete, for a minor or an athlete with no birthdate (decision #30)", async () => {
    for (const birthdate of ["2014-09-08", undefined]) {
      const data = addAthleteInput.parse({
        firstName: "Rory",
        lastName: "Gilmore",
        birthdate,
        guardianEmail: "parent@example.com",
        emailRecipient: "athlete",
      });
      const err = await caught(() =>
        addAthleteWithGuardian(
          { userId: "u", admin: fakeClient({ coach_profiles: { id: "coach-1" } }) },
          data,
          new Date("2026-09-06T12:00:00Z"),
        ),
      );
      expect(err?.status).toBe(422);
      expect(err?.message).toMatch(/Invite the parent or guardian/);
    }
  });

  it("a known adult may be invited directly", async () => {
    const data = addAthleteInput.parse({
      firstName: "Lane",
      lastName: "Kim",
      birthdate: "1990-01-01",
      guardianEmail: "lane@example.com",
      emailRecipient: "athlete",
    });
    const admin = fakeClient({
      coach_profiles: { id: "coach-1", subscription_tier: "coach_pro" },
      athletes: { id: "new-athlete" },
    });
    const result = await addAthleteWithGuardian(
      { userId: "u", admin },
      data,
      new Date("2026-09-06T12:00:00Z"),
    );
    expect(result.athleteId).toBe("new-athlete");
  });

  it("a birthdate in the future is refused", async () => {
    const data = addAthleteInput.parse({ firstName: "R", lastName: "G", birthdate: "2030-01-01" });
    const err = await caught(() =>
      addAthleteWithGuardian(
        { userId: "u", admin: fakeClient({ coach_profiles: { id: "coach-1" } }) },
        data,
        new Date("2026-09-06T12:00:00Z"),
      ),
    );
    expect(err?.message).toBe("Enter a valid birthdate");
  });

  it("a basic-tier coach at the 5-athlete cap is refused before any row is written", async () => {
    const data = addAthleteInput.parse({ firstName: "R", lastName: "G" });
    const admin = fakeClient(
      { coach_profiles: { id: "coach-1" } },
      { coach_athletes: [1, 2, 3, 4, 5].map((n) => ({ athlete_id: `a${n}` })) },
    );
    let message: string | null = null;
    try {
      await addAthleteWithGuardian({ userId: "u", admin }, data);
    } catch (err) {
      message = err instanceof Error ? err.message : null;
    }
    expect(message).toBe(
      "Roster full: the coach plan is limited to 5 athletes. Upgrade to add more.",
    );
  });

  it("a coach_pro coach under their 50-athlete cap is not blocked", async () => {
    const data = addAthleteInput.parse({ firstName: "R", lastName: "G" });
    const admin = fakeClient(
      {
        coach_profiles: { id: "coach-1", subscription_tier: "coach_pro" },
        athletes: { id: "new-athlete" },
      },
      { coach_athletes: [1, 2, 3, 4, 5].map((n) => ({ athlete_id: `a${n}` })) },
    );
    const result = await addAthleteWithGuardian({ userId: "u", admin }, data);
    expect(result.athleteId).toBe("new-athlete");
  });
});

describe("getPendingLessonWrapUps", () => {
  it("keeps the latest ended lesson per athlete, drops handled ones, and coerces query strings", async () => {
    const query = pendingWrapUpsInput.parse({
      lessonDate: "2026-09-08",
      dayOfWeek: "2",
      currentMinute: "1000",
    });
    expect(query.dayOfWeek).toBe(2);
    const supabase = fakeClient(
      { coach_profiles: { id: "coach-1" } },
      {
        athlete_lesson_slots: [
          { athlete_id: "a1", end_minute: 900 },
          { athlete_id: "a1", end_minute: 960 },
          { athlete_id: "a2", end_minute: 930 },
        ],
        lesson_wrap_ups: [{ athlete_id: "a2" }],
        plans: [{ id: "plan-1", athlete_id: "a1" }],
        athletes: [
          { id: "a1", first_name: "Rory", last_name: "Gilmore" },
          { id: "a2", first_name: "Ava", last_name: "Kowalczyk" },
        ],
      },
    );
    const pending = await getPendingLessonWrapUps({ userId: "u", supabase }, query);
    expect(pending).toEqual([
      {
        athleteId: "a1",
        athleteName: "Rory Gilmore",
        lessonDate: "2026-09-08",
        lessonEndMinute: 960,
        activePlanId: "plan-1",
      },
    ]);
  });

  it("is empty for a user who is not a coach", async () => {
    const query = pendingWrapUpsInput.parse({
      lessonDate: "2026-09-08",
      dayOfWeek: 2,
      currentMinute: 1000,
    });
    expect(await getPendingLessonWrapUps({ userId: "u", supabase: fakeClient({}) }, query)).toEqual(
      [],
    );
  });
});

describe("rosterClaimStatus", () => {
  const off = { verificationRequired: false };
  const on = { verificationRequired: true };
  const MINOR = "2014-05-01";
  const ADULT = "1990-05-01";
  const coachAdded = {
    parent_id: null,
    self_managed: false,
    guardian_email: "parent@example.com",
    guardian_claimed_at: null,
    invite_recipient: "guardian",
    birthdate: MINOR,
    account_state: "active",
    parent_adult_verified_at: null,
  };

  it("waits for the parent while a parent invite is out and unclaimed (decision #30)", () => {
    expect(rosterClaimStatus(coachAdded, off)).toBe("waitingForParent");
    // No birthdate counts as a minor, and rows from before invite_recipient read as a parent invite.
    expect(rosterClaimStatus({ ...coachAdded, birthdate: null, invite_recipient: null }, off)).toBe(
      "waitingForParent",
    );
  });

  it("waits for the athlete when a known adult was invited directly, and is claimed once they claim", () => {
    const adult = { ...coachAdded, birthdate: ADULT, invite_recipient: "athlete" };
    expect(rosterClaimStatus(adult, on)).toBe("waitingForAthlete");
    expect(
      rosterClaimStatus(
        {
          ...adult,
          self_managed: true,
          guardian_email: null,
          guardian_claimed_at: "2026-10-03T00:00:00Z",
        },
        on,
      ),
    ).toBe("claimed");
  });

  it("a minor with a parent on file is claimed, unless verification is required and the parent hasn't verified", () => {
    const linked = { ...coachAdded, parent_id: "p-1", guardian_claimed_at: "2026-10-03T00:00:00Z" };
    expect(rosterClaimStatus(linked, off)).toBe("claimed");
    expect(rosterClaimStatus(linked, on)).toBe("waitingForParent");
    expect(
      rosterClaimStatus({ ...linked, parent_adult_verified_at: "2026-10-03T00:00:00Z" }, on),
    ).toBe("claimed");
  });

  it("a provisional minor always waits for the parent; a pre-S1 self-sign-up minor waits only once verification is required", () => {
    const selfSignUp = { ...coachAdded, self_managed: true };
    expect(rosterClaimStatus({ ...selfSignUp, account_state: "provisional" }, off)).toBe(
      "waitingForParent",
    );
    expect(rosterClaimStatus(selfSignUp, off)).toBe("claimed");
    expect(rosterClaimStatus(selfSignUp, on)).toBe("waitingForParent");
  });

  it("is not invited when no email is on file", () => {
    expect(rosterClaimStatus({ ...coachAdded, guardian_email: null }, off)).toBe("notInvited");
    expect(rosterClaimStatus({ ...coachAdded, birthdate: ADULT, guardian_email: null }, off)).toBe(
      "notInvited",
    );
  });
});

describe("rosterCanMessage", () => {
  const minor = {
    parent_id: null,
    self_managed: false,
    guardian_email: "parent@example.com",
    guardian_claimed_at: null,
    invite_recipient: "guardian",
    birthdate: "2012-05-01",
    account_state: "active",
    parent_adult_verified_at: null,
    messaging_paused_at: null,
  };
  const off = { verificationRequired: false };
  const on = { verificationRequired: true };

  it("a minor whose parent hasn't joined can never be messaged, switch on or off (decision #56)", () => {
    expect(rosterCanMessage(minor, off)).toBe(false);
    expect(rosterCanMessage(minor, on)).toBe(false);
    expect(rosterCanMessage({ ...minor, birthdate: null }, off)).toBe(false);
  });

  it("a linked parent opens the room; verification is extra only while the switch is on", () => {
    const linked = { ...minor, parent_id: "p1" };
    expect(rosterCanMessage(linked, off)).toBe(true);
    expect(rosterCanMessage(linked, on)).toBe(false);
    expect(
      rosterCanMessage({ ...linked, parent_adult_verified_at: "2026-10-01T00:00:00Z" }, on),
    ).toBe(true);
  });

  it("provisional and paused accounts and a parent's pause close it for anyone", () => {
    expect(rosterCanMessage({ ...minor, parent_id: "p1", account_state: "provisional" }, off)).toBe(
      false,
    );
    expect(rosterCanMessage({ ...minor, parent_id: "p1", account_state: "paused" }, off)).toBe(
      false,
    );
    expect(
      rosterCanMessage(
        { ...minor, parent_id: "p1", messaging_paused_at: "2026-10-01T00:00:00Z" },
        off,
      ),
    ).toBe(false);
    expect(
      rosterCanMessage(
        { ...minor, birthdate: "1990-01-01", messaging_paused_at: "2026-10-01T00:00:00Z" },
        off,
      ),
    ).toBe(false);
  });

  it("an adult is otherwise free, invited directly or not", () => {
    expect(rosterCanMessage({ ...minor, birthdate: "1990-01-01" }, on)).toBe(true);
    expect(
      rosterCanMessage({ ...minor, birthdate: "1990-01-01", invite_recipient: "athlete" }, on),
    ).toBe(true);
  });
});
