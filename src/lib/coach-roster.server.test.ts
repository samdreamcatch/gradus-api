import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import {
  addAthleteInput,
  addAthleteWithGuardian,
  addLessonSlotInput,
  cancelLessonOccurrence,
  deleteLessonSlot,
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
    self.then = (resolve: (v: unknown) => void) =>
      resolve({ data: lists[table] ?? [], error: null });
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
    const times = { dayOfWeek: 2, startMinute: 600, endMinute: 660 };
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
          { id: "a2", first_name: "Ava", last_name: "Petrenko" },
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
