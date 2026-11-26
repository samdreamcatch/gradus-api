import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import { pendingWrapUpSchema, pendingWrapUpsSchema } from "./api/roster-schema";
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

type Sort = { col: string; ascending: boolean };

/** What PostgREST answers with at most, however many rows match, unless the project changes it. */
const MAX_ROWS = 1000;

type ReadError = { code: string; message: string };
type Answer = { data: Row[] | null; count: number | null; error: ReadError | null };

/**
 * A table-backed fake for reads: select + eq/in filters + `order` (the first
 * call is the main key, later calls break ties) + `range`, awaited or
 * `maybeSingle`. Like the real thing, one answer holds at most `maxRows`
 * rows (`MAX_ROWS` unless the test sets the project's cap lower) and says
 * nothing about the rest, and `count`, how many matched in all, is there only
 * when the select asked for `{ count: "exact" }`: otherwise it is null.
 * `opts.errors[table]` makes every read of that table come back with the error.
 */
function fakeTables(
  tables: Record<string, Row[]>,
  opts: { maxRows?: number; errors?: Record<string, ReadError> } = {},
) {
  const maxRows = opts.maxRows ?? MAX_ROWS;
  const query = (name: string, counted: boolean) => {
    const error = opts.errors?.[name] ?? null;
    const make = (rows: Row[], sorts: Sort[] = [], window: [number, number] | null = null) => {
      const sorted = () =>
        [...rows].sort((a, b) => {
          for (const { col, ascending } of sorts) {
            const x = String(a[col] ?? "");
            const y = String(b[col] ?? "");
            if (x !== y) return (x < y ? -1 : 1) * (ascending ? 1 : -1);
          }
          return 0;
        });
      const answered = () => {
        const from = window?.[0] ?? 0;
        const to = Math.min(window?.[1] ?? Infinity, from + maxRows - 1);
        return sorted().slice(from, to + 1);
      };
      return {
        eq: (col: string, val: unknown) =>
          make(
            rows.filter((r) => r[col] === val),
            sorts,
            window,
          ),
        in: (col: string, vals: unknown[]) =>
          make(
            rows.filter((r) => vals.includes(r[col])),
            sorts,
            window,
          ),
        order: (col: string, o: { ascending?: boolean } = {}) =>
          make(rows, [...sorts, { col, ascending: o.ascending ?? true }], window),
        range: (from: number, to: number) => make(rows, sorts, [from, to]),
        maybeSingle: async () =>
          error ? { data: null, error } : { data: sorted()[0] ?? null, error: null },
        then: (resolve: (v: Answer) => void) =>
          resolve(
            error
              ? { data: null, count: null, error }
              : { data: answered(), count: counted ? rows.length : null, error: null },
          ),
      };
    };
    return make(tables[name] ?? []);
  };
  return {
    from: (name: string) => ({
      select: (_columns?: string, o?: { count?: string }) => query(name, o?.count === "exact"),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
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
/** A plan row: this coach's active plan for `a1` unless `over` says otherwise. */
const plan = (id: string, over: Row = {}): Row => ({
  id,
  athlete_id: "a1",
  coach_id: "coach-1",
  kind: "plan",
  status: "active",
  title: "Edges and turns",
  created_at: "2026-09-01T10:00:00Z",
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
const pending = (
  t: Record<string, Row[]>,
  minute: number,
  opts: Parameters<typeof fakeTables>[1] = {},
) =>
  getPendingLessonWrapUps({ userId: "user-1", supabase: fakeTables(tables(t), opts) }, at(minute));

describe("getPendingLessonWrapUps asks only about lessons that happened today", () => {
  it("a weekly lesson is pending once it ends, latest first, with its exact shape", async () => {
    const t = {
      athlete_lesson_slots: [
        lessonSlot({ id: "s1" }), // 09:00-09:30
        lessonSlot({ id: "s2", athlete_id: "a2", start_minute: 600, end_minute: 630 }),
        lessonSlot({ id: "s3", athlete_id: "a3", start_minute: 900, end_minute: 930 }), // not over
        lessonSlot({ id: "s4", athlete_id: "a3", coach_id: "coach-2" }), // someone else's
      ],
      plans: [plan("p1", { athlete_id: "a2", title: "Spin entries" })],
    };
    expect(await pending(t, 8 * 60)).toEqual([]);
    expect(await pending(t, 11 * 60)).toEqual([
      {
        athleteId: "a2",
        athleteName: "Linnea Corwin",
        lessonDate: TODAY,
        lessonEndMinute: 630,
        activePlanId: "p1",
        activePlans: [{ id: "p1", title: "Spin entries" }],
      },
      {
        athleteId: "a1",
        athleteName: "Tobias Fairbank",
        lessonDate: TODAY,
        lessonEndMinute: 570,
        activePlanId: null,
        activePlans: [],
      },
    ]);
  });

  it("carries every active plan the coach has for the athlete, newest first, a tie by id descending", async () => {
    const t = {
      athlete_lesson_slots: [lessonSlot({ id: "s1" }), lessonSlot({ id: "s2", athlete_id: "a2" })],
      // Stored oldest first, the opposite of the order asked for.
      plans: [
        plan("p-z", { title: "Edges and turns", created_at: "2026-08-01T09:00:00Z" }),
        plan("p-a", { title: "Spin entries", created_at: "2026-09-15T09:00:00Z" }),
        plan("p-b", { title: "", created_at: "2026-09-15T09:00:00Z" }),
        plan("p-c", { title: "Jump warm-up", created_at: "2026-10-02T09:00:00Z" }),
        plan("p-l", { athlete_id: "a2", title: "Stroking", created_at: "2026-07-05T09:00:00Z" }),
      ],
    };
    const rows = await pending(t, 11 * 60);
    expect(rows.map((w) => [w.athleteId, w.activePlanId, w.activePlans])).toEqual([
      [
        "a1",
        // The most recent one, not the highest id.
        "p-c",
        [
          { id: "p-c", title: "Jump warm-up" },
          // Made at the same moment: the higher id first.
          // An unnamed plan keeps its stored empty title, as the per-athlete route returns it.
          { id: "p-b", title: "" },
          { id: "p-a", title: "Spin entries" },
          { id: "p-z", title: "Edges and turns" },
        ],
      ],
      ["a2", "p-l", [{ id: "p-l", title: "Stroking" }]],
    ]);
  });

  it("reads past the 1,000 rows one answer holds, so the plans made longest ago are not cut off", async () => {
    // No cap on active plans (#52): one athlete's recent plans fill the first
    // answer, and the plans made before them belong to someone else. Read no
    // further, that athlete would come back with no plans at all.
    const many = Array.from({ length: MAX_ROWS }, (_, i) =>
      plan(`new-${String(i).padStart(4, "0")}`, { created_at: "2026-10-05T09:00:00Z" }),
    );
    const t = {
      athlete_lesson_slots: [lessonSlot({ id: "s1" }), lessonSlot({ id: "s2", athlete_id: "a2" })],
      plans: [
        plan("old-a", { athlete_id: "a2", title: "Spins", created_at: "2026-08-01T09:00:00Z" }),
        ...many,
        plan("old-b", { athlete_id: "a2", title: "Stroking", created_at: "2026-08-02T09:00:00Z" }),
      ],
    };
    const rows = await pending(t, 11 * 60);
    const of = (athleteId: string) => rows.find((w) => w.athleteId === athleteId);
    expect(of("a1")?.activePlans).toHaveLength(MAX_ROWS);
    // Each plan once: the pages neither repeat nor skip a row of a long tie.
    expect(new Set(of("a1")?.activePlans?.map((p) => p.id)).size).toBe(MAX_ROWS);
    expect(of("a1")?.activePlanId).toBe(`new-${String(MAX_ROWS - 1).padStart(4, "0")}`);
    expect(of("a2")?.activePlanId).toBe("old-b");
    expect(of("a2")?.activePlans).toEqual([
      { id: "old-b", title: "Stroking" },
      { id: "old-a", title: "Spins" },
    ]);
  });

  it("reads to the end on a project whose answers stop short of a page, by asking for the count", async () => {
    // A project can set its row cap below the 1,000 a page asks for. A short
    // answer then looks like the last one, and only the count of all matching
    // rows says there is more: without it, the plans made longest ago are lost.
    const cap = 250;
    const many = Array.from({ length: 600 }, (_, i) =>
      plan(`new-${String(i).padStart(4, "0")}`, { created_at: "2026-10-05T09:00:00Z" }),
    );
    const t = {
      athlete_lesson_slots: [lessonSlot({ id: "s1" }), lessonSlot({ id: "s2", athlete_id: "a2" })],
      plans: [
        ...many,
        plan("old-a", { athlete_id: "a2", title: "Spins", created_at: "2026-08-01T09:00:00Z" }),
      ],
    };
    const rows = await pending(t, 11 * 60, { maxRows: cap });
    const of = (athleteId: string) => rows.find((w) => w.athleteId === athleteId);
    expect(of("a1")?.activePlans).toHaveLength(600);
    expect(new Set(of("a1")?.activePlans?.map((p) => p.id)).size).toBe(600);
    expect(of("a2")?.activePlans).toEqual([{ id: "old-a", title: "Spins" }]);
    expect(of("a2")?.activePlanId).toBe("old-a");
  });

  it("a failed plans read fails the whole answer, never rows that say 'no plans'", async () => {
    // The client trusts `activePlans` and does not ask the per-athlete route
    // again: an empty list from a read that failed would hide Re-deploy and
    // Edit plan for every athlete.
    const t = {
      athlete_lesson_slots: [lessonSlot({ id: "s1" })],
      plans: [plan("p1")],
    };
    const original = console.error;
    console.error = () => {};
    try {
      await expect(
        pending(t, 11 * 60, { errors: { plans: { code: "XX000", message: "boom" } } }),
      ).rejects.toThrow("Something went wrong. Please try again.");
    } finally {
      console.error = original;
    }
  });

  it("leaves out another coach's plans, drafts, deleted plans and templates", async () => {
    const t = {
      athlete_lesson_slots: [lessonSlot({ id: "s1" }), lessonSlot({ id: "s2", athlete_id: "a2" })],
      plans: [
        plan("other-coach", { coach_id: "coach-2", created_at: "2026-08-01T09:00:00Z" }),
        plan("athlete-own", { coach_id: null, created_at: "2026-08-02T09:00:00Z" }),
        plan("draft", { status: "draft", created_at: "2026-08-03T09:00:00Z" }),
        plan("deleted", { status: "benched", created_at: "2026-08-04T09:00:00Z" }), // decision #67
        // A template has no athlete in the database; given one here so only `kind` rules it out.
        plan("template", { kind: "template", created_at: "2026-08-05T09:00:00Z" }),
        plan("mine", { title: "Jump warm-up", created_at: "2026-10-02T09:00:00Z" }),
        plan("other-coach-2", { athlete_id: "a2", coach_id: "coach-2" }),
      ],
    };
    const rows = await pending(t, 11 * 60);
    expect(rows.map((w) => [w.athleteId, w.activePlanId, w.activePlans])).toEqual([
      ["a1", "mine", [{ id: "mine", title: "Jump warm-up" }]],
      ["a2", null, []],
    ]);
  });

  it("up next names the same plan as the wrap-up will, for an athlete with several", async () => {
    const t = tables({
      athlete_lesson_slots: [lessonSlot({ id: "s1" })],
      // Stored oldest first; the two newest were made at the same moment.
      plans: [
        plan("p-old", { created_at: "2026-09-15T09:00:00Z" }),
        plan("p-a", { created_at: "2026-10-02T09:00:00Z" }),
        plan("p-b", { created_at: "2026-10-02T09:00:00Z" }),
      ],
    });
    const client = fakeTables(t);
    const upNext = await getUpNext(
      { userId: "user-1", admin: client },
      upNextInput.parse({ lessonDate: TODAY, dayOfWeek: 3, currentMinute: 8 * 60 }),
    );
    const wrapUps = await getPendingLessonWrapUps({ userId: "user-1", supabase: client }, at(600));
    expect(upNext.map((l) => l.activePlanId)).toEqual(["p-b"]);
    expect(wrapUps.map((w) => w.activePlanId)).toEqual(["p-b"]);
    expect(wrapUps[0]?.activePlans?.map((p) => p.id)).toEqual(["p-b", "p-a", "p-old"]);
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

describe("pendingWrapUpSchema (what the route sends: unknown keys are dropped there)", () => {
  const row = {
    athleteId: "a1",
    athleteName: "Tobias Fairbank",
    lessonDate: TODAY,
    lessonEndMinute: 570,
    activePlanId: "p1",
    activePlans: [
      { id: "p1", title: "Edges and turns" },
      { id: "p2", title: "" },
    ],
    groupId: "g1",
  };

  it("keeps activePlans, on a row and in the list response", () => {
    expect(pendingWrapUpSchema.parse(row)).toEqual(row);
    const none = { ...row, activePlanId: null, activePlans: [] };
    expect(pendingWrapUpsSchema.parse({ wrapUps: [row, none] })).toEqual({ wrapUps: [row, none] });
  });

  it("keeps what the server function returns, whole", async () => {
    const rows = await pending(
      {
        athlete_lesson_slots: [lessonSlot({ id: "s1", group_id: "g1" })],
        plans: [plan("p1"), plan("p2", { title: "Spin entries" })],
      },
      11 * 60,
    );
    expect(rows[0]?.activePlans).toHaveLength(2);
    expect(pendingWrapUpsSchema.parse({ wrapUps: rows })).toEqual({ wrapUps: rows });
  });

  it("the list is optional on the wire: a row from a server that predates it still decodes", () => {
    // The iPhone decodes through a client generated from this contract, where
    // a required field missing from an older server's answer fails the whole
    // list. Absent means "older server", never "no plans".
    const { activePlans: _absent, ...older } = row;
    expect(pendingWrapUpSchema.parse(older)).toEqual(older);
    expect(pendingWrapUpsSchema.parse({ wrapUps: [older, row] })).toEqual({
      wrapUps: [older, row],
    });
    expect(pendingWrapUpSchema.shape.activePlans.isOptional()).toBe(true);
  });

  it("this server sends the list on every row, empty when there are no plans", async () => {
    const rows = await pending(
      {
        athlete_lesson_slots: [
          lessonSlot({ id: "s1" }),
          lessonSlot({ id: "s2", athlete_id: "a2" }),
        ],
      },
      11 * 60,
    );
    expect(rows.map((w) => w.activePlans)).toEqual([[], []]);
  });
});
