import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import {
  buildRosterSlots,
  cancelLessonOccurrence,
  cancelOccurrenceInput,
  deleteLessonSlot,
  rescheduleLessonOccurrence,
  updateLessonSlot,
} from "./coach-roster.server";
import {
  groupFlag,
  groupedSlotTimes,
  isGroupedSlot,
  replaceFamilySlots,
} from "./lesson-group-guard.server";
import {
  clearGroupOccurrence,
  createLessonGroup,
  createLessonGroupInput,
  deleteLessonGroup,
  setGroupOccurrence,
  setGroupOccurrenceInput,
  updateLessonGroup,
  updateLessonGroupInput,
} from "./lesson-groups.server";
import { rosterSlotSchema } from "./api/roster-schema";
import { scheduleSlotSchema } from "./api/athlete-schema";

/* -------------------------------------------------------------------------- */
/* A small stateful fake of the service-role client                           */
/* -------------------------------------------------------------------------- */

type Row = Record<string, unknown>;
type Filter = { op: "eq" | "in" | "is"; col: string; val: unknown };

const matches = (row: Row, filters: Filter[]) =>
  filters.every((f) =>
    f.op === "in"
      ? (f.val as unknown[]).includes(row[f.col])
      : f.op === "is"
        ? (row[f.col] ?? null) === f.val
        : row[f.col] === f.val,
  );

/**
 * `missing` names columns the database "doesn't have yet": any select or
 * write that mentions one fails with Postgres 42703, as it would before
 * migration 20261115120000 is applied.
 */
function makeDb(missing: string[] = []) {
  const tables: Record<string, Row[]> = {
    coach_profiles: [],
    coach_athletes: [],
    athlete_lesson_slots: [],
    lesson_slot_overrides: [],
  };
  const undefinedColumn = { code: "42703", message: "column does not exist" };
  const names = (payload: Row | Row[] | null) =>
    payload ? (Array.isArray(payload) ? payload : [payload]).flatMap((r) => Object.keys(r)) : [];

  function builder(table: string) {
    const filters: Filter[] = [];
    let mode: "select" | "insert" | "upsert" | "update" | "delete" = "select";
    let payload: Row | Row[] | null = null;
    let conflict: string[] = [];
    let columns = "";

    const run = (): { data: Row[] | null; error: typeof undefinedColumn | null } => {
      const mentioned = [
        ...columns.split(",").map((c) => c.trim()),
        ...filters.map((f) => f.col),
        ...names(payload),
      ];
      if (mentioned.some((c) => missing.includes(c))) return { data: null, error: undefinedColumn };
      const rows = tables[table]!;
      if (mode === "insert") {
        const added = (Array.isArray(payload) ? payload : [payload!]).map((r) => ({
          id: crypto.randomUUID(),
          ...r,
        }));
        rows.push(...added);
        return { data: added, error: null };
      }
      if (mode === "upsert") {
        for (const p of Array.isArray(payload) ? payload : [payload!]) {
          const i = rows.findIndex((r) => conflict.every((k) => r[k] === p[k]));
          if (i >= 0) rows[i] = { ...rows[i], ...p };
          else rows.push({ id: crypto.randomUUID(), ...p });
        }
        return { data: null, error: null };
      }
      if (mode === "update") {
        for (const r of rows) if (matches(r, filters)) Object.assign(r, payload as Row);
        return { data: null, error: null };
      }
      if (mode === "delete") {
        const gone = rows.filter((r) => matches(r, filters));
        tables[table] = rows.filter((r) => !matches(r, filters));
        // Overrides go with their slot (ON DELETE CASCADE).
        if (table === "athlete_lesson_slots") {
          const ids = gone.map((r) => r.id);
          tables.lesson_slot_overrides = tables.lesson_slot_overrides!.filter(
            (o) => !ids.includes(o.slot_id),
          );
        }
        return { data: [], error: null };
      }
      return { data: rows.filter((r) => matches(r, filters)), error: null };
    };

    const api = {
      select(cols: string) {
        columns = cols;
        return api;
      },
      eq(col: string, val: unknown) {
        filters.push({ op: "eq", col, val });
        return api;
      },
      in(col: string, val: unknown) {
        filters.push({ op: "in", col, val });
        return api;
      },
      is(col: string, val: unknown) {
        filters.push({ op: "is", col, val });
        return api;
      },
      insert(p: Row | Row[]) {
        mode = "insert";
        payload = p;
        return api;
      },
      upsert(p: Row | Row[], opts: { onConflict: string }) {
        mode = "upsert";
        payload = p;
        conflict = opts.onConflict.split(",");
        return api;
      },
      update(p: Row) {
        mode = "update";
        payload = p;
        return api;
      },
      delete() {
        mode = "delete";
        return api;
      },
      async maybeSingle() {
        const res = run();
        return { data: res.data?.[0] ?? null, error: res.error };
      },
      then(resolve: (v: unknown) => void) {
        resolve(run());
      },
    };
    return api;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { tables, admin: { from: (t: string) => builder(t) } as any };
}

const USER = "11111111-1111-4111-8111-111111111111";
const COACH = "22222222-2222-4222-8222-222222222222";
const OTHER_COACH = "99999999-9999-4999-8999-999999999999";
const GROUP = "77777777-7777-4777-8777-777777777777";
const athlete = (n: number) => `a${n}aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const DATE = "2026-11-13";

const friday5pm = {
  dayOfWeek: 5,
  startMinute: 1020,
  endMinute: 1080,
  frequency: "weekly" as const,
  weeksOfMonth: [] as number[],
  startsOn: null,
};

function seeded(rostered: number, missing: string[] = []) {
  const db = makeDb(missing);
  db.tables.coach_profiles!.push({ id: COACH, user_id: USER });
  for (let n = 1; n <= rostered; n += 1) {
    db.tables.coach_athletes!.push({ id: `link-${n}`, coach_id: COACH, athlete_id: athlete(n) });
  }
  return { db, ctx: { userId: USER, admin: db.admin } };
}

/** Seeds a group of the first `size` rostered athletes directly, as the database would hold it. */
function seedGroup(db: ReturnType<typeof makeDb>, size: number, priceCents: number | null = 3000) {
  for (let n = 1; n <= size; n += 1) {
    db.tables.athlete_lesson_slots!.push({
      id: `slot-${n}`,
      athlete_id: athlete(n),
      coach_id: COACH,
      day_of_week: 5,
      start_minute: 1020,
      end_minute: 1080,
      frequency: "weekly",
      weeks_of_month: [],
      starts_on: null,
      group_id: GROUP,
      price_cents: priceCents,
    });
  }
}

async function caught(run: () => Promise<unknown>): Promise<ApiError | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof ApiError ? err : null;
  }
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => athlete(i + 1));

/* -------------------------------------------------------------------------- */

describe("group lesson inputs", () => {
  it("take two to eight distinct athletes", () => {
    const parse = (athleteIds: string[]) =>
      createLessonGroupInput.safeParse({ athleteIds, ...friday5pm }).success;
    expect(parse(ids(1))).toBe(false);
    expect(parse(ids(2))).toBe(true);
    expect(parse(ids(8))).toBe(true);
    expect(parse(ids(9))).toBe(false);
    expect(parse([athlete(1), athlete(1)])).toBe(false);
  });

  it("keep the single-lesson time and cadence rules", () => {
    const base = { athleteIds: ids(2), ...friday5pm };
    expect(createLessonGroupInput.safeParse({ ...base, endMinute: 1000 }).success).toBe(false);
    expect(createLessonGroupInput.safeParse({ ...base, frequency: "biweekly" }).success).toBe(
      false,
    );
    expect(createLessonGroupInput.safeParse({ ...base, priceCents: -1 }).success).toBe(false);
    expect(createLessonGroupInput.parse(base).priceCents).toBeNull();
  });

  it("a one-date change refuses the same athlete twice and defaults to nobody out", () => {
    expect(setGroupOccurrenceInput.parse({})).toEqual({ reschedule: null, out: [] });
    expect(
      setGroupOccurrenceInput.safeParse({
        out: [{ athleteId: athlete(1) }, { athleteId: athlete(1), billable: true }],
      }).success,
    ).toBe(false);
  });

  it("the cancel body is optional, and only an explicit true bills", () => {
    expect(cancelOccurrenceInput.parse(undefined)).toEqual({ billable: false });
    expect(cancelOccurrenceInput.parse({})).toEqual({ billable: false });
    expect(cancelOccurrenceInput.parse({ billable: true })).toEqual({ billable: true });
  });
});

describe("createLessonGroup", () => {
  it("adds one slot per athlete, all sharing the group, schedule and price", async () => {
    const { db, ctx } = seeded(3);
    const res = await createLessonGroup(
      ctx,
      createLessonGroupInput.parse({ athleteIds: ids(3), ...friday5pm, priceCents: 3000 }),
    );

    const slots = db.tables.athlete_lesson_slots!;
    expect(slots).toHaveLength(3);
    expect(res.slotIds).toEqual(slots.map((s) => s.id as string));
    expect(new Set(slots.map((s) => s.group_id))).toEqual(new Set([res.id]));
    expect(slots.map((s) => s.athlete_id)).toEqual(ids(3));
    for (const s of slots) {
      expect(s).toMatchObject({
        coach_id: COACH,
        day_of_week: 5,
        start_minute: 1020,
        end_minute: 1080,
        price_cents: 3000,
      });
    }
  });

  it("refuses an athlete who isn't on the roster, before writing anything", async () => {
    const { db, ctx } = seeded(2);
    const err = await caught(() =>
      createLessonGroup(ctx, createLessonGroupInput.parse({ athleteIds: ids(3), ...friday5pm })),
    );
    expect(err?.status).toBe(422);
    expect(db.tables.athlete_lesson_slots).toHaveLength(0);
  });

  it("answers 503, not a database error, before the migration is applied", async () => {
    const { db, ctx } = seeded(2, ["group_id", "price_cents", "billable"]);
    const err = await caught(() =>
      createLessonGroup(ctx, createLessonGroupInput.parse({ athleteIds: ids(2), ...friday5pm })),
    );
    expect(err?.status).toBe(503);
    expect(db.tables.athlete_lesson_slots).toHaveLength(0);
  });
});

describe("updateLessonGroup", () => {
  it("moves the schedule and price for every member at once", async () => {
    const { db, ctx } = seeded(3);
    seedGroup(db, 3);
    await updateLessonGroup(
      ctx,
      GROUP,
      updateLessonGroupInput.parse({
        schedule: { ...friday5pm, dayOfWeek: 2, startMinute: 900, endMinute: 960 },
        priceCents: 3500,
      }),
    );
    for (const s of db.tables.athlete_lesson_slots!) {
      expect(s).toMatchObject({
        day_of_week: 2,
        start_minute: 900,
        end_minute: 960,
        price_cents: 3500,
        group_id: GROUP,
      });
    }
  });

  it("leaves prices alone when none is sent, and clears them on null", async () => {
    const { db, ctx } = seeded(2);
    seedGroup(db, 2);
    await updateLessonGroup(ctx, GROUP, updateLessonGroupInput.parse({ schedule: friday5pm }));
    expect(db.tables.athlete_lesson_slots!.map((s) => s.price_cents)).toEqual([3000, 3000]);
    await updateLessonGroup(ctx, GROUP, updateLessonGroupInput.parse({ priceCents: null }));
    expect(db.tables.athlete_lesson_slots!.map((s) => s.price_cents)).toEqual([null, null]);
  });

  it("adds an athlete on the group's schedule and price", async () => {
    const { db, ctx } = seeded(4);
    seedGroup(db, 3);
    await updateLessonGroup(
      ctx,
      GROUP,
      updateLessonGroupInput.parse({ addAthleteIds: [athlete(4)] }),
    );
    const added = db.tables.athlete_lesson_slots!.find((s) => s.athlete_id === athlete(4));
    expect(added).toMatchObject({
      group_id: GROUP,
      day_of_week: 5,
      start_minute: 1020,
      price_cents: 3000,
      coach_id: COACH,
    });
  });

  it("removes an athlete along with their overrides, and nobody else's lesson", async () => {
    const { db, ctx } = seeded(3);
    seedGroup(db, 3);
    db.tables.lesson_slot_overrides!.push(
      { slot_id: "slot-2", occurrence_date: DATE, status: "canceled" },
      { slot_id: "slot-3", occurrence_date: DATE, status: "canceled" },
    );
    await updateLessonGroup(
      ctx,
      GROUP,
      updateLessonGroupInput.parse({ removeAthleteIds: [athlete(2)] }),
    );
    expect(db.tables.athlete_lesson_slots!.map((s) => s.id)).toEqual(["slot-1", "slot-3"]);
    expect(db.tables.lesson_slot_overrides!.map((o) => o.slot_id)).toEqual(["slot-3"]);
    expect(db.tables.athlete_lesson_slots!.every((s) => s.group_id === GROUP)).toBe(true);
  });

  it("a group left with one athlete becomes a private lesson that keeps its price", async () => {
    const { db, ctx } = seeded(2);
    seedGroup(db, 2);
    await updateLessonGroup(
      ctx,
      GROUP,
      updateLessonGroupInput.parse({ removeAthleteIds: [athlete(2)] }),
    );
    expect(db.tables.athlete_lesson_slots).toHaveLength(1);
    expect(db.tables.athlete_lesson_slots![0]).toMatchObject({
      id: "slot-1",
      group_id: null,
      price_cents: 3000,
    });
  });

  it("refuses a ninth athlete, removing everyone, and add-and-remove together", async () => {
    const { db, ctx } = seeded(9);
    seedGroup(db, 8);
    const attempt = (body: unknown) =>
      caught(() => updateLessonGroup(ctx, GROUP, updateLessonGroupInput.parse(body)));

    expect((await attempt({ addAthleteIds: [athlete(9)] }))?.status).toBe(422);
    expect((await attempt({ removeAthleteIds: ids(8) }))?.status).toBe(422);
    // Removing someone who is already out is a no-op, so a change can be re-sent.
    expect(await attempt({ removeAthleteIds: [athlete(9)] })).toBeNull();
    expect(
      (await attempt({ addAthleteIds: [athlete(9)], removeAthleteIds: [athlete(9)] }))?.status,
    ).toBe(422);
    expect(db.tables.athlete_lesson_slots).toHaveLength(8);
  });

  it("swapping one athlete for another at eight is allowed", async () => {
    const { db, ctx } = seeded(9);
    seedGroup(db, 8);
    await updateLessonGroup(
      ctx,
      GROUP,
      updateLessonGroupInput.parse({ addAthleteIds: [athlete(9)], removeAthleteIds: [athlete(1)] }),
    );
    const members = db.tables.athlete_lesson_slots!.map((s) => s.athlete_id);
    expect(members).toHaveLength(8);
    expect(members).toContain(athlete(9));
    expect(members).not.toContain(athlete(1));
  });

  it("another coach's group is not found", async () => {
    const { db, ctx } = seeded(2);
    seedGroup(db, 2);
    for (const s of db.tables.athlete_lesson_slots!) s.coach_id = OTHER_COACH;
    const err = await caught(() =>
      updateLessonGroup(ctx, GROUP, updateLessonGroupInput.parse({ priceCents: 0 })),
    );
    expect(err?.status).toBe(404);
    expect(db.tables.athlete_lesson_slots!.map((s) => s.price_cents)).toEqual([3000, 3000]);
  });
});

describe("deleteLessonGroup", () => {
  it("removes every member's lesson and leaves other lessons alone", async () => {
    const { db, ctx } = seeded(3);
    seedGroup(db, 3);
    db.tables.athlete_lesson_slots!.push({
      id: "private",
      athlete_id: athlete(1),
      coach_id: COACH,
      group_id: null,
    });
    await deleteLessonGroup(ctx, GROUP);
    expect(db.tables.athlete_lesson_slots!.map((s) => s.id)).toEqual(["private"]);
  });

  it("is 404 for a group that doesn't exist", async () => {
    const { ctx } = seeded(1);
    expect((await caught(() => deleteLessonGroup(ctx, GROUP)))?.status).toBe(404);
  });
});

describe("setGroupOccurrence / clearGroupOccurrence", () => {
  it("cancels only the athletes who are out, each billed or not as chosen", async () => {
    const { db, ctx } = seeded(4);
    seedGroup(db, 4);
    await setGroupOccurrence(
      ctx,
      GROUP,
      DATE,
      setGroupOccurrenceInput.parse({
        out: [{ athleteId: athlete(2), billable: true }, { athleteId: athlete(3) }],
      }),
    );
    const overrides = db.tables.lesson_slot_overrides!;
    expect(overrides).toHaveLength(2);
    expect(overrides.find((o) => o.slot_id === "slot-2")).toMatchObject({
      occurrence_date: DATE,
      status: "canceled",
      billable: true,
    });
    expect(overrides.find((o) => o.slot_id === "slot-3")).toMatchObject({
      status: "canceled",
      billable: false,
    });
  });

  it("replaces the date: someone marked out earlier who is now coming loses their override", async () => {
    const { db, ctx } = seeded(3);
    seedGroup(db, 3);
    const set = (body: unknown) =>
      setGroupOccurrence(ctx, GROUP, DATE, setGroupOccurrenceInput.parse(body));
    await set({ out: [{ athleteId: athlete(1), billable: true }] });
    await set({ out: [{ athleteId: athlete(2) }] });
    expect(db.tables.lesson_slot_overrides!.map((o) => o.slot_id)).toEqual(["slot-2"]);
  });

  it("moves everyone who is coming to the new time, and never bills a moved lesson", async () => {
    const { db, ctx } = seeded(3);
    seedGroup(db, 3);
    await setGroupOccurrence(
      ctx,
      GROUP,
      DATE,
      setGroupOccurrenceInput.parse({
        reschedule: { startMinute: 1080, endMinute: 1140 },
        out: [{ athleteId: athlete(3), billable: true }],
      }),
    );
    const byId = (id: string) => db.tables.lesson_slot_overrides!.find((o) => o.slot_id === id);
    for (const id of ["slot-1", "slot-2"]) {
      expect(byId(id)).toMatchObject({
        status: "rescheduled",
        start_minute: 1080,
        end_minute: 1140,
        billable: false,
      });
    }
    expect(byId("slot-3")).toMatchObject({ status: "canceled", billable: true });
  });

  it("leaves other dates and other lessons untouched", async () => {
    const { db, ctx } = seeded(2);
    seedGroup(db, 2);
    db.tables.lesson_slot_overrides!.push(
      { slot_id: "slot-1", occurrence_date: "2026-11-20", status: "canceled" },
      { slot_id: "elsewhere", occurrence_date: DATE, status: "canceled" },
    );
    await setGroupOccurrence(ctx, GROUP, DATE, setGroupOccurrenceInput.parse({}));
    await clearGroupOccurrence(ctx, GROUP, DATE);
    expect(db.tables.lesson_slot_overrides).toHaveLength(2);
  });

  it("refuses an athlete who isn't in the group, before writing anything", async () => {
    const { db, ctx } = seeded(3);
    seedGroup(db, 2);
    const err = await caught(() =>
      setGroupOccurrence(
        ctx,
        GROUP,
        DATE,
        setGroupOccurrenceInput.parse({ out: [{ athleteId: athlete(3) }] }),
      ),
    );
    expect(err?.status).toBe(422);
    expect(db.tables.lesson_slot_overrides).toHaveLength(0);
  });

  it("clearing puts the date back for everyone", async () => {
    const { db, ctx } = seeded(2);
    seedGroup(db, 2);
    await setGroupOccurrence(
      ctx,
      GROUP,
      DATE,
      setGroupOccurrenceInput.parse({
        out: [{ athleteId: athlete(1) }, { athleteId: athlete(2) }],
      }),
    );
    await clearGroupOccurrence(ctx, GROUP, DATE);
    expect(db.tables.lesson_slot_overrides).toHaveLength(0);
  });
});

describe("single-lesson routes and a grouped slot", () => {
  it("one member's time can't be moved on its own", async () => {
    const { db, ctx } = seeded(2);
    seedGroup(db, 2);
    const err = await caught(() => updateLessonSlot(ctx, "slot-1", { ...friday5pm, dayOfWeek: 1 }));
    expect(err?.status).toBe(422);
    expect(db.tables.athlete_lesson_slots![0]!.day_of_week).toBe(5);
  });

  it("a private lesson still moves", async () => {
    const { db, ctx } = seeded(1);
    seedGroup(db, 1);
    db.tables.athlete_lesson_slots![0]!.group_id = null;
    await updateLessonSlot(ctx, "slot-1", { ...friday5pm, dayOfWeek: 1 });
    expect(db.tables.athlete_lesson_slots![0]!.day_of_week).toBe(1);
  });

  it("deleting one member's lesson takes them out; the last one left goes private", async () => {
    const { db, ctx } = seeded(3);
    seedGroup(db, 3);
    await deleteLessonSlot(ctx, "slot-3");
    expect(db.tables.athlete_lesson_slots!.map((s) => s.group_id)).toEqual([GROUP, GROUP]);
    await deleteLessonSlot(ctx, "slot-2");
    expect(db.tables.athlete_lesson_slots).toHaveLength(1);
    expect(db.tables.athlete_lesson_slots![0]!.group_id).toBeNull();
  });

  it("cancel stores 'still bill', and a plain re-cancel clears it", async () => {
    const { db, ctx } = seeded(1);
    seedGroup(db, 1);
    await cancelLessonOccurrence(ctx, "slot-1", DATE, { billable: true });
    expect(db.tables.lesson_slot_overrides![0]).toMatchObject({
      status: "canceled",
      billable: true,
    });
    await cancelLessonOccurrence(ctx, "slot-1", DATE);
    expect(db.tables.lesson_slot_overrides).toHaveLength(1);
    expect(db.tables.lesson_slot_overrides![0]!.billable).toBe(false);
  });

  it("before the migration, a plain cancel works as it always did and 'still bill' is 503", async () => {
    const { db, ctx } = seeded(1, ["group_id", "price_cents", "billable"]);
    db.tables.athlete_lesson_slots!.push({ id: "slot-1", athlete_id: athlete(1), coach_id: COACH });

    await cancelLessonOccurrence(ctx, "slot-1", DATE);
    expect(db.tables.lesson_slot_overrides).toHaveLength(1);
    expect("billable" in db.tables.lesson_slot_overrides![0]!).toBe(false);

    const err = await caught(() =>
      cancelLessonOccurrence(ctx, "slot-1", "2026-11-20", { billable: true }),
    );
    expect(err?.status).toBe(503);
    expect(db.tables.lesson_slot_overrides).toHaveLength(1);

    // The other single-lesson writes don't trip over the missing column either.
    await updateLessonSlot(ctx, "slot-1", { ...friday5pm, dayOfWeek: 1 });
    await deleteLessonSlot(ctx, "slot-1");
    expect(db.tables.athlete_lesson_slots).toHaveLength(0);
  });
});

describe("what a parent or athlete learns about a group (PRD §6.16 G)", () => {
  const slot = { dayOfWeek: 5, startMinute: 1020, endMinute: 1080 };

  it("only that their own lesson is a group lesson", async () => {
    const { db } = seeded(3);
    seedGroup(db, 3);
    const grouped = await groupedSlotTimes(db.admin, [athlete(1)]);

    // Their own slot only: nothing about the other two members.
    expect(grouped).toEqual([{ athleteId: athlete(1), coachId: COACH, ...slot }]);
    expect(groupFlag(grouped, athlete(1), COACH, slot)).toEqual({ group: true });
    expect(groupFlag(grouped, athlete(1), COACH, { ...slot, dayOfWeek: 1 })).toEqual({});
    expect(isGroupedSlot(grouped, athlete(1), OTHER_COACH, slot)).toBe(false);
  });

  it("the schedule they receive carries a boolean and no group id, size or names", () => {
    const parsed = scheduleSlotSchema.parse({
      ...slot,
      frequency: "weekly",
      weeksOfMonth: [],
      startsOn: null,
      group: true,
      groupId: GROUP,
      priceCents: 3000,
      members: ["someone else"],
    });
    expect(parsed).toEqual({
      ...slot,
      frequency: "weekly",
      weeksOfMonth: [],
      startsOn: null,
      group: true,
    });
  });

  it("is empty, not an error, before the migration is applied", async () => {
    const { db } = seeded(1, ["group_id"]);
    db.tables.athlete_lesson_slots!.push({ id: "s", athlete_id: athlete(1), coach_id: COACH });
    expect(await groupedSlotTimes(db.admin, [athlete(1)])).toEqual([]);
  });
});

describe("coach roster slot schema", () => {
  const slot = {
    id: "slot-1",
    dayOfWeek: 5,
    startMinute: 1020,
    endMinute: 1080,
    frequency: "weekly",
    weeksOfMonth: [],
    startsOn: null,
    overrides: [{ date: DATE, status: "canceled", startMinute: null, endMinute: null }],
  };

  it("still accepts a slot with none of the new fields (what an older server sent)", () => {
    expect(rosterSlotSchema.parse(slot)).toEqual(slot);
  });

  it("carries the group link, the lesson price and a billed cancellation", () => {
    const withGroup = {
      ...slot,
      groupId: GROUP,
      priceCents: 3000,
      overrides: [{ ...slot.overrides[0], billable: true }],
    };
    expect(rosterSlotSchema.parse(withGroup)).toEqual(withGroup);
  });
});

describe("coach roster slots (buildRosterSlots)", () => {
  const row = (id: string, athleteId: string, extra: Record<string, unknown> = {}) => ({
    id,
    athlete_id: athleteId,
    day_of_week: 5,
    start_minute: 1020,
    end_minute: 1080,
    frequency: "weekly",
    weeks_of_month: [],
    starts_on: null,
    ...extra,
  });

  it("sends the group id only for a real group of two or more", () => {
    const slots = buildRosterSlots(
      [
        row("s1", "a1", { group_id: GROUP, price_cents: 3000 }),
        row("s2", "a2", { group_id: GROUP, price_cents: 3000 }),
        // Its partners were removed some other way: a private lesson with a price.
        row("s3", "a3", { group_id: "lonely", price_cents: 2500 }),
        row("s4", "a4", { group_id: null, price_cents: null }),
      ],
      [],
    );
    expect(slots.get("a1")![0]).toMatchObject({ groupId: GROUP, priceCents: 3000 });
    expect(slots.get("a2")![0]).toMatchObject({ groupId: GROUP, priceCents: 3000 });
    expect(slots.get("a3")![0]!.groupId).toBeUndefined();
    expect(slots.get("a3")![0]!.priceCents).toBe(2500);
    expect("groupId" in slots.get("a4")![0]!).toBe(false);
    expect("priceCents" in slots.get("a4")![0]!).toBe(false);
  });

  it("marks only a canceled date as billed, and is unchanged for pre-migration rows", () => {
    const slots = buildRosterSlots(
      [row("s1", "a1")],
      [
        {
          slot_id: "s1",
          occurrence_date: "2026-11-13",
          status: "canceled",
          start_minute: null,
          end_minute: null,
          billable: true,
        },
        {
          slot_id: "s1",
          occurrence_date: "2026-11-20",
          status: "canceled",
          start_minute: null,
          end_minute: null,
        },
        {
          slot_id: "s1",
          occurrence_date: "2026-11-27",
          status: "rescheduled",
          start_minute: 900,
          end_minute: 960,
          billable: true,
        },
      ],
    );
    expect(slots.get("a1")![0]).toEqual({
      id: "s1",
      dayOfWeek: 5,
      startMinute: 1020,
      endMinute: 1080,
      frequency: "weekly",
      weeksOfMonth: [],
      startsOn: null,
      overrides: [
        {
          date: "2026-11-13",
          status: "canceled",
          startMinute: null,
          endMinute: null,
          billable: true,
        },
        { date: "2026-11-20", status: "canceled", startMinute: null, endMinute: null },
        { date: "2026-11-27", status: "rescheduled", startMinute: 900, endMinute: 960 },
      ],
    });
  });
});

describe("review fixes (PR #287)", () => {
  const monday10 = { ...friday5pm, dayOfWeek: 1, startMinute: 600, endMinute: 660 };
  const privateSlot = (id: string, n: number, over: Row = {}) => ({
    id,
    athlete_id: athlete(n),
    coach_id: COACH,
    day_of_week: 1,
    start_minute: 600,
    end_minute: 660,
    frequency: "weekly",
    weeks_of_month: [],
    starts_on: null,
    group_id: null,
    price_cents: null,
    ...over,
  });

  it("a family save keeps the group lesson and the unchanged lesson's row", async () => {
    const { db } = seeded(2);
    seedGroup(db, 2);
    db.tables.athlete_lesson_slots!.push(privateSlot("private-1", 1));
    db.tables.lesson_slot_overrides!.push({
      slot_id: "private-1",
      occurrence_date: DATE,
      status: "canceled",
      billable: true,
    });

    // The family sends back everything they see, plus one new lesson.
    await replaceFamilySlots(db.admin, athlete(1), COACH, [
      friday5pm,
      monday10,
      { ...monday10, dayOfWeek: 2 },
    ]);

    const mine = db.tables.athlete_lesson_slots!.filter((s) => s.athlete_id === athlete(1));
    expect(mine).toHaveLength(3);
    // Same rows as before: the group slot, and the private one with its
    // "still bill" cancellation.
    expect(mine.find((s) => s.id === "slot-1")?.group_id).toBe(GROUP);
    expect(mine.some((s) => s.id === "private-1")).toBe(true);
    expect(mine.filter((s) => s.day_of_week === 5)).toHaveLength(1);
    expect(mine.find((s) => s.day_of_week === 2)?.group_id ?? null).toBeNull();
    expect(db.tables.lesson_slot_overrides).toHaveLength(1);
  });

  it("a lesson the coach put beside the group lesson doesn't block the family's save", async () => {
    const { db } = seeded(2);
    seedGroup(db, 2);
    const beside = { day_of_week: 5, start_minute: 1050, end_minute: 1110 };
    db.tables.athlete_lesson_slots!.push(privateSlot("beside", 1, beside));

    // The family re-sends what they were shown, unchanged.
    await replaceFamilySlots(db.admin, athlete(1), COACH, [
      friday5pm,
      { ...friday5pm, startMinute: 1050, endMinute: 1110 },
    ]);
    const mine = db.tables.athlete_lesson_slots!.filter((s) => s.athlete_id === athlete(1));
    expect(mine.map((s) => s.id).sort()).toEqual(["beside", "slot-1"]);
  });

  it("the coach-less save only touches coach-less lessons", async () => {
    const { db } = seeded(1);
    db.tables.athlete_lesson_slots!.push(privateSlot("with-coach", 1));
    db.tables.athlete_lesson_slots!.push(privateSlot("no-coach", 1, { coach_id: null }));
    await replaceFamilySlots(db.admin, athlete(1), null, [{ ...monday10, dayOfWeek: 3 }]);
    const rows = db.tables.athlete_lesson_slots!;
    expect(rows.some((s) => s.id === "with-coach")).toBe(true);
    expect(rows.some((s) => s.id === "no-coach")).toBe(false);
    expect(rows.find((s) => s.day_of_week === 3)?.coach_id).toBeNull();
  });

  it("a group can't be moved onto a member's other lesson, unless the weeks never meet", async () => {
    const { db, ctx } = seeded(2);
    seedGroup(db, 2);
    db.tables.athlete_lesson_slots!.push(privateSlot("private-1", 1));
    const move = (schedule: object) =>
      caught(() => updateLessonGroup(ctx, GROUP, updateLessonGroupInput.parse({ schedule })));

    expect((await move(monday10))?.status).toBe(422);

    Object.assign(db.tables.athlete_lesson_slots![2]!, {
      frequency: "biweekly",
      starts_on: "2026-11-02",
    });
    expect(await move({ ...monday10, frequency: "biweekly", startsOn: "2026-11-09" })).toBeNull();
  });

  it("a family save drops a lesson they removed, and can't move the group lesson", async () => {
    const { db } = seeded(2);
    seedGroup(db, 2);
    db.tables.athlete_lesson_slots!.push(privateSlot("private-1", 1));

    await replaceFamilySlots(db.admin, athlete(1), COACH, []);
    expect(db.tables.athlete_lesson_slots!.map((s) => s.id)).toEqual(["slot-1", "slot-2"]);

    const err = await caught(() =>
      replaceFamilySlots(db.admin, athlete(1), COACH, [{ ...friday5pm, startMinute: 1050 }]),
    );
    expect(err?.status).toBe(422);
    expect(db.tables.athlete_lesson_slots).toHaveLength(2);
  });

  it("a family save works before the migration", async () => {
    const { db } = seeded(1, ["group_id", "price_cents"]);
    db.tables.athlete_lesson_slots!.push({
      id: "old",
      athlete_id: athlete(1),
      coach_id: COACH,
      day_of_week: 5,
      start_minute: 1020,
      end_minute: 1080,
      frequency: "weekly",
      weeks_of_month: [],
      starts_on: null,
    });
    await replaceFamilySlots(db.admin, athlete(1), COACH, [monday10]);
    expect(db.tables.athlete_lesson_slots!.map((s) => s.day_of_week)).toEqual([1]);
  });

  it("a slot left alone in its group reads as private and can be edited", async () => {
    const { db, ctx } = seeded(2);
    seedGroup(db, 2);
    db.tables.athlete_lesson_slots!.pop(); // the partner went some other way

    expect(await groupedSlotTimes(db.admin, [athlete(1)])).toEqual([]);
    await updateLessonSlot(ctx, "slot-1", { ...friday5pm, dayOfWeek: 1 });
    expect(db.tables.athlete_lesson_slots![0]).toMatchObject({ day_of_week: 1, group_id: null });
  });

  it("one member's date can't be moved on its own", async () => {
    const { db, ctx } = seeded(2);
    seedGroup(db, 2);
    const err = await caught(() =>
      rescheduleLessonOccurrence(ctx, "slot-1", DATE, { startMinute: 600, endMinute: 660 }),
    );
    expect(err?.status).toBe(422);
    expect(db.tables.lesson_slot_overrides).toHaveLength(0);
  });

  it("an athlete with a lesson at that time can't be put in a group on top of it", async () => {
    const { db, ctx } = seeded(3);
    db.tables.athlete_lesson_slots!.push(
      privateSlot("private-1", 1, { day_of_week: 5, start_minute: 1050, end_minute: 1110 }),
    );
    const create = await caught(() =>
      createLessonGroup(ctx, createLessonGroupInput.parse({ athleteIds: ids(2), ...friday5pm })),
    );
    expect(create?.status).toBe(422);
    expect(db.tables.athlete_lesson_slots).toHaveLength(1);

    db.tables.athlete_lesson_slots!.length = 0;
    seedGroup(db, 2);
    db.tables.athlete_lesson_slots!.push(
      privateSlot("private-3", 3, { day_of_week: 5, start_minute: 1020, end_minute: 1080 }),
    );
    const add = await caught(() =>
      updateLessonGroup(ctx, GROUP, updateLessonGroupInput.parse({ addAthleteIds: [athlete(3)] })),
    );
    expect(add?.status).toBe(422);
  });

  it("create checks the roster and the clash together, and the roster refusal wins when both fail", async () => {
    const ROSTER = "Every athlete in a group lesson must be on your roster";
    const { db, ctx } = seeded(2); // the third athlete is not on the roster
    db.tables.athlete_lesson_slots!.push(
      privateSlot("private-1", 1, { day_of_week: 5, start_minute: 1050, end_minute: 1110 }),
    );
    // The roster read answers late, so the clash refusal is ready first.
    const events: string[] = [];
    const admin = {
      from: (table: string) => {
        const query = db.admin.from(table);
        const answer = query.then;
        if (table === "coach_athletes") {
          query.then = (resolve: (v: unknown) => void) => {
            events.push("roster asked");
            setTimeout(() => {
              events.push("roster answered");
              answer(resolve);
            }, 5);
          };
        } else if (table === "athlete_lesson_slots") {
          query.then = (resolve: (v: unknown) => void) => {
            events.push("clash asked");
            answer(resolve);
          };
        }
        return query;
      },
    };
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => void unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const err = await caught(() =>
        createLessonGroup(
          { ...ctx, admin: admin as typeof ctx.admin },
          createLessonGroupInput.parse({ athleteIds: ids(3), ...friday5pm }),
        ),
      );
      await new Promise((done) => setTimeout(done, 0));
      expect(events).toEqual(["roster asked", "clash asked", "roster answered"]);
      expect(err?.status).toBe(422);
      expect(err?.message).toBe(ROSTER);
      expect(db.tables.athlete_lesson_slots).toHaveLength(1);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    // Before the migration the clash read answers 503; the roster refusal still comes first.
    const early = seeded(2, ["group_id", "price_cents", "billable"]);
    const before = await caught(() =>
      createLessonGroup(
        early.ctx,
        createLessonGroupInput.parse({ athleteIds: ids(3), ...friday5pm }),
      ),
    );
    expect(before?.status).toBe(422);
    expect(before?.message).toBe(ROSTER);
  });

  it("a change that failed part-way can be sent again", async () => {
    const { db, ctx } = seeded(3);
    seedGroup(db, 3);
    // The first attempt removed two athletes and then failed.
    db.tables.athlete_lesson_slots!.splice(1, 2);

    await updateLessonGroup(
      ctx,
      GROUP,
      updateLessonGroupInput.parse({ removeAthleteIds: [athlete(2), athlete(3)] }),
    );
    expect(db.tables.athlete_lesson_slots).toHaveLength(1);
    expect(db.tables.athlete_lesson_slots![0]!.group_id).toBeNull();
  });

  it("a new member takes the price the remaining members share", async () => {
    const { db, ctx } = seeded(4);
    seedGroup(db, 3);
    db.tables.athlete_lesson_slots![2]!.price_cents = 9900;
    await updateLessonGroup(
      ctx,
      GROUP,
      updateLessonGroupInput.parse({ removeAthleteIds: [athlete(3)], addAthleteIds: [athlete(4)] }),
    );
    const added = db.tables.athlete_lesson_slots!.find((s) => s.athlete_id === athlete(4));
    expect(added?.price_cents).toBe(3000);
  });
});
