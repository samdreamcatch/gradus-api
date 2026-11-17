import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import { getUpNext, upNextInput } from "./coach-up-next.server";
import {
  getPendingLessonWrapUps,
  pendingWrapUpsInput,
  recordLessonWrapUp,
} from "./lesson-wrap-ups.server";

type Write = { table: string; op: string; payload: unknown; options: unknown };

/**
 * A chainable fake: `rows[table]` answers `maybeSingle` (a missing key is `null`), `opts.writes`
 * records every upsert with its payload and options, and `opts.errors["table.op"]` makes that
 * write come back with the error.
 */
function fakeClient(
  rows: Record<string, unknown | null>,
  opts: { writes?: Write[]; errors?: Record<string, { code: string; message: string }> } = {},
) {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    let op: string | null = null;
    self.select = () => self;
    self.eq = () => self;
    self.upsert = (payload: unknown, options: unknown) => {
      op = "upsert";
      opts.writes?.push({ table, op, payload, options });
      return self;
    };
    self.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
    self.then = (resolve: (v: unknown) => void) =>
      resolve({ data: null, error: op ? (opts.errors?.[`${table}.${op}`] ?? null) : null });
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

const coach = { coach_profiles: { id: "coach-1" } };
/** The coach has athlete `a1` on their roster; any other athlete id reads as not rostered. */
const roster = { coach_athletes: { athlete_id: "a1" } };
const wrapUp = (athleteId: string) => ({
  athleteId,
  lessonDate: "2026-10-05",
  action: "dismissed" as const,
});

describe("recordLessonWrapUp stays on the coach's roster", () => {
  it("an athlete not on the roster is 403 and writes nothing", async () => {
    const writes: Write[] = [];
    const supabase = fakeClient({ ...coach }, { writes });
    const err = await caught(() =>
      recordLessonWrapUp({ userId: "u", supabase }, wrapUp("a-stranger")),
    );
    expect(err?.status).toBe(403);
    expect(err?.code).toBe("forbidden");
    expect(err?.message).toBe("Athlete is not on your roster");
    expect(writes).toEqual([]);
  });

  it("an athlete on the roster gets the upsert, keyed on (coach, athlete, date)", async () => {
    const writes: Write[] = [];
    const supabase = fakeClient({ ...coach, ...roster }, { writes });
    await expect(recordLessonWrapUp({ userId: "u", supabase }, wrapUp("a1"))).resolves.toEqual({
      ok: true,
    });
    expect(writes).toEqual([
      {
        table: "lesson_wrap_ups",
        op: "upsert",
        payload: {
          coach_id: "coach-1",
          athlete_id: "a1",
          lesson_date: "2026-10-05",
          action: "dismissed",
        },
        options: { onConflict: "coach_id,athlete_id,lesson_date" },
      },
    ]);
  });

  it("the database's refusal (the roster policy, if it ever disagrees) is the same 403", async () => {
    const supabase = fakeClient(
      { ...coach, ...roster },
      {
        errors: {
          "lesson_wrap_ups.upsert": {
            code: "42501",
            message: 'new row violates row-level security policy for table "lesson_wrap_ups"',
          },
        },
      },
    );
    const err = await caught(() => recordLessonWrapUp({ userId: "u", supabase }, wrapUp("a1")));
    expect(err?.status).toBe(403);
    expect(err?.message).toBe("Athlete is not on your roster");
  });

  it("any other database error stays a generic failure, not a roster answer", async () => {
    const supabase = fakeClient(
      { ...coach, ...roster },
      { errors: { "lesson_wrap_ups.upsert": { code: "XX000", message: "boom" } } },
    );
    const original = console.error;
    console.error = () => {};
    try {
      await expect(recordLessonWrapUp({ userId: "u", supabase }, wrapUp("a1"))).rejects.toThrow(
        "Something went wrong. Please try again.",
      );
    } finally {
      console.error = original;
    }
  });

  it("a caller who is not a coach is 403 wrong_role, before any roster lookup", async () => {
    const writes: Write[] = [];
    const supabase = fakeClient({}, { writes });
    const err = await caught(() => recordLessonWrapUp({ userId: "u", supabase }, wrapUp("a1")));
    expect(err?.status).toBe(403);
    expect(err?.code).toBe("wrong_role");
    expect(writes).toEqual([]);
  });
});

type Row = Record<string, unknown>;

/** A table-backed fake for reads: select + eq/in filters, awaited or `maybeSingle`. */
function fakeTables(tables: Record<string, Row[]>) {
  const make = (rows: Row[]) => ({
    eq: (col: string, val: unknown) => make(rows.filter((r) => r[col] === val)),
    in: (col: string, vals: unknown[]) => make(rows.filter((r) => vals.includes(r[col]))),
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (v: { data: Row[]; error: null }) => void) =>
      resolve({ data: rows, error: null }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (name: string) => ({ select: () => make(tables[name] ?? []) }) } as any;
}

const TODAY = "2026-10-07"; // a Wednesday
const lessonSlot = (over: Row = {}): Row => ({
  id: "s1",
  coach_id: "coach-1",
  athlete_id: "a1",
  day_of_week: 3,
  start_minute: 9 * 60,
  end_minute: 9 * 60 + 30,
  frequency: "weekly",
  weeks_of_month: [],
  starts_on: null,
  ...over,
});
const override = (slotId: string, over: Row): Row => ({
  slot_id: slotId,
  occurrence_date: TODAY,
  start_minute: null,
  end_minute: null,
  ...over,
});
const tables = (extra: Record<string, Row[]>) => ({
  coach_profiles: [{ id: "coach-1", user_id: "user-1" }],
  athletes: [
    { id: "a1", first_name: "Tobias", last_name: "Fairbank" },
    { id: "a2", first_name: "Linnea", last_name: "Corwin" },
    { id: "a3", first_name: "Renata", last_name: "Pruitt" },
  ],
  ...extra,
});
const at = (minute: number) =>
  pendingWrapUpsInput.parse({ lessonDate: TODAY, dayOfWeek: 3, currentMinute: minute });
const pending = (t: Record<string, Row[]>, minute: number) =>
  getPendingLessonWrapUps({ userId: "user-1", supabase: fakeTables(tables(t)) }, at(minute));

describe("getPendingLessonWrapUps asks only about lessons that happened today", () => {
  it("a weekly lesson is pending once it ends, latest first, with the unchanged shape", async () => {
    const t = {
      athlete_lesson_slots: [
        lessonSlot({ id: "s1" }), // 09:00-09:30
        lessonSlot({ id: "s2", athlete_id: "a2", start_minute: 600, end_minute: 630 }),
        lessonSlot({ id: "s3", athlete_id: "a3", start_minute: 900, end_minute: 930 }), // not over
        lessonSlot({ id: "s4", athlete_id: "a3", coach_id: "coach-2" }), // someone else's
      ],
      plans: [{ id: "p1", athlete_id: "a2", coach_id: "coach-1", kind: "plan", status: "active" }],
    };
    expect(await pending(t, 8 * 60)).toEqual([]);
    expect(await pending(t, 11 * 60)).toEqual([
      {
        athleteId: "a2",
        athleteName: "Linnea Corwin",
        lessonDate: TODAY,
        lessonEndMinute: 630,
        activePlanId: "p1",
      },
      {
        athleteId: "a1",
        athleteName: "Tobias Fairbank",
        lessonDate: TODAY,
        lessonEndMinute: 570,
        activePlanId: null,
      },
    ]);
  });

  it("a group lesson's members carry its id; a lone leftover link reads as private (GL4)", async () => {
    const t = {
      athlete_lesson_slots: [
        lessonSlot({ id: "s1", group_id: "g1" }),
        lessonSlot({ id: "s2", athlete_id: "a2", group_id: "g1" }),
        lessonSlot({ id: "s3", athlete_id: "a3", group_id: "g-lone" }),
      ],
    };
    const rows = await pending(t, 11 * 60);
    expect(rows.map((w) => [w.athleteId, w.groupId])).toEqual([
      ["a1", "g1"],
      ["a2", "g1"],
      ["a3", undefined],
    ]);
    expect("groupId" in rows[2]).toBe(false);
  });

  it("a group member out for the day is not pending, and the rest still read as a group", async () => {
    const t = {
      athlete_lesson_slots: [
        lessonSlot({ id: "s1", group_id: "g1" }),
        lessonSlot({ id: "s2", athlete_id: "a2", group_id: "g1" }),
      ],
      lesson_slot_overrides: [override("s1", { status: "canceled" })],
    };
    expect((await pending(t, 11 * 60)).map((w) => [w.athleteId, w.groupId])).toEqual([
      ["a2", "g1"],
    ]);
  });

  it("a lesson canceled for today is not pending; another date's cancellation does not apply", async () => {
    const t = {
      athlete_lesson_slots: [lessonSlot({ id: "s1" }), lessonSlot({ id: "s2", athlete_id: "a2" })],
      lesson_slot_overrides: [
        override("s1", { status: "canceled" }),
        override("s2", { status: "canceled", occurrence_date: "2026-10-14" }),
      ],
    };
    expect((await pending(t, 11 * 60)).map((w) => w.athleteId)).toEqual(["a2"]);
  });

  it("a lesson rescheduled later today waits for its new end, and reports that end", async () => {
    const t = {
      athlete_lesson_slots: [lessonSlot({ id: "s1" })], // base 09:00-09:30
      lesson_slot_overrides: [
        override("s1", { status: "rescheduled", start_minute: 18 * 60, end_minute: 18 * 60 + 30 }),
      ],
    };
    expect(await pending(t, 17 * 60 + 45)).toEqual([]);
    expect((await pending(t, 18 * 60 + 30)).map((w) => w.lessonEndMinute)).toEqual([1110]);
  });

  it("a lesson rescheduled earlier today is pending from its new end", async () => {
    const t = {
      athlete_lesson_slots: [lessonSlot({ id: "s1", start_minute: 960, end_minute: 990 })],
      lesson_slot_overrides: [
        override("s1", { status: "rescheduled", start_minute: 7 * 60, end_minute: 7 * 60 + 30 }),
      ],
    };
    expect((await pending(t, 8 * 60)).map((w) => w.lessonEndMinute)).toEqual([450]);
  });

  it("a biweekly or twice-monthly lesson in its off week is not pending", async () => {
    const t = {
      athlete_lesson_slots: [
        lessonSlot({ id: "s1", frequency: "biweekly", starts_on: "2026-09-30" }), // on 09-30, 10-14
        lessonSlot({ id: "s2", athlete_id: "a2", frequency: "biweekly", starts_on: "2026-10-07" }),
        // 10-07 is the 1st Wednesday of October
        lessonSlot({
          id: "s3",
          athlete_id: "a3",
          frequency: "twice_monthly",
          weeks_of_month: [2, 4],
        }),
      ],
    };
    expect((await pending(t, 11 * 60)).map((w) => w.athleteId)).toEqual(["a2"]);
  });

  it("one row per athlete at their latest real lesson, and none once wrapped up", async () => {
    const t = {
      athlete_lesson_slots: [
        lessonSlot({ id: "s1" }), // 09:00-09:30
        lessonSlot({ id: "s2", start_minute: 600, end_minute: 630 }), // canceled today
        lessonSlot({ id: "s3", athlete_id: "a2" }),
      ],
      lesson_slot_overrides: [override("s2", { status: "canceled" })],
      lesson_wrap_ups: [
        { coach_id: "coach-1", athlete_id: "a2", lesson_date: TODAY, action: "dismissed" },
      ],
    };
    expect((await pending(t, 11 * 60)).map((w) => [w.athleteId, w.lessonEndMinute])).toEqual([
      ["a1", 570],
    ]);
  });

  it("never claims a lesson that up next still shows (rescheduled later, the reported overlap)", async () => {
    const t = tables({
      athlete_lesson_slots: [lessonSlot({ id: "s1" })],
      lesson_slot_overrides: [
        override("s1", { status: "rescheduled", start_minute: 15 * 60 + 15, end_minute: 16 * 60 }),
      ],
    });
    const client = fakeTables(t);
    const minute = 15 * 60;
    const upNext = await getUpNext(
      { userId: "user-1", admin: client },
      upNextInput.parse({ lessonDate: TODAY, dayOfWeek: 3, currentMinute: minute }),
    );
    expect(upNext.map((l) => [l.athleteId, l.minutesUntilStart])).toEqual([["a1", 15]]);
    expect(
      await getPendingLessonWrapUps({ userId: "user-1", supabase: client }, at(minute)),
    ).toEqual([]);
  });
});
