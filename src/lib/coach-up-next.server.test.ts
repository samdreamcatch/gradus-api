import { describe, expect, it } from "bun:test";
import type { UpNextContext } from "./coach-up-next.server";
import { getUpNext, upNextInput } from "./coach-up-next.server";

type Row = Record<string, unknown>;

/** Exactly the query shapes `getUpNext` issues: select + eq/in filters + maybeSingle. */
function fakeAdmin(tables: Record<string, Row[]>): UpNextContext["admin"] {
  const make = (rows: Row[]) => {
    const q = {
      eq: (col: string, val: unknown) => make(rows.filter((r) => r[col] === val)),
      in: (col: string, vals: unknown[]) => make(rows.filter((r) => vals.includes(r[col]))),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => void) =>
        resolve({ data: rows, error: null }),
    };
    return q;
  };
  return {
    from: (name: string) => ({ select: () => make(tables[name] ?? []) }),
  } as unknown as UpNextContext["admin"];
}

const COACH = { id: "coach-1", user_id: "user-1" };
const slot = (over: Row = {}): Row => ({
  id: "s1",
  coach_id: "coach-1",
  athlete_id: "a1",
  day_of_week: 3, // 2026-10-07 is a Wednesday
  start_minute: 16 * 60,
  end_minute: 16 * 60 + 30,
  frequency: "weekly",
  weeks_of_month: [],
  starts_on: null,
  ...over,
});
const DATE = "2026-10-07";
const ask = (minute: number, extra: Record<string, unknown> = {}) =>
  upNextInput.parse({ lessonDate: DATE, dayOfWeek: 3, currentMinute: minute, ...extra });

const athletes = [
  { id: "a1", first_name: "Tobias", last_name: "Fairbank" },
  { id: "a2", first_name: "Linnea", last_name: "Corwin" },
  { id: "a3", first_name: "Renata", last_name: "Pruitt" },
];

function ctx(tables: Record<string, Row[]>): UpNextContext {
  return { userId: "user-1", admin: fakeAdmin({ coach_profiles: [COACH], athletes, ...tables }) };
}

describe("getUpNext", () => {
  it("lists lessons that have not ended, soonest first, with names and minutes until", async () => {
    const out = await getUpNext(
      ctx({
        athlete_lesson_slots: [
          slot({ id: "s2", athlete_id: "a2", start_minute: 17 * 60, end_minute: 17 * 60 + 30 }),
          slot({ id: "s1" }),
        ],
      }),
      ask(15 * 60 + 45),
    );
    expect(out.map((l) => l.athleteFirstName)).toEqual(["Tobias", "Linnea"]);
    expect(out[0]).toMatchObject({
      athleteName: "Tobias Fairbank",
      startMinute: 960,
      minutesUntilStart: 15,
      inProgress: false,
      lessonDate: DATE,
    });
  });

  it("keeps a lesson that is in progress (negative minutes) and drops one that has ended", async () => {
    const out = await getUpNext(
      ctx({
        athlete_lesson_slots: [
          slot({ id: "s1", start_minute: 15 * 60, end_minute: 15 * 60 + 30 }), // ended
          slot({
            id: "s2",
            athlete_id: "a2",
            start_minute: 15 * 60 + 40,
            end_minute: 16 * 60 + 10,
          }),
        ],
      }),
      ask(15 * 60 + 50),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      athleteFirstName: "Linnea",
      inProgress: true,
      minutesUntilStart: -10,
    });
  });

  it("drops a canceled occurrence and uses a rescheduled one's times", async () => {
    const out = await getUpNext(
      ctx({
        athlete_lesson_slots: [
          slot({ id: "s1" }),
          slot({ id: "s2", athlete_id: "a2", start_minute: 17 * 60, end_minute: 17 * 60 + 30 }),
          slot({ id: "s3", athlete_id: "a3", start_minute: 9 * 60, end_minute: 9 * 60 + 30 }),
        ],
        lesson_slot_overrides: [
          {
            slot_id: "s1",
            occurrence_date: DATE,
            status: "canceled",
            start_minute: null,
            end_minute: null,
          },
          {
            slot_id: "s3",
            occurrence_date: DATE,
            status: "rescheduled",
            start_minute: 18 * 60,
            end_minute: 18 * 60 + 30,
          },
          // another date's override must not apply
          {
            slot_id: "s2",
            occurrence_date: "2026-10-14",
            status: "canceled",
            start_minute: null,
            end_minute: null,
          },
        ],
      }),
      ask(8 * 60),
    );
    expect(out.map((l) => [l.athleteFirstName, l.startMinute])).toEqual([
      ["Linnea", 1020],
      ["Renata", 1080],
    ]);
  });

  it("skips a biweekly slot on its off week", async () => {
    const out = await getUpNext(
      ctx({
        athlete_lesson_slots: [
          slot({ id: "s1", frequency: "biweekly", starts_on: "2026-09-30" }), // on: 09-30, 10-14
          slot({ id: "s2", athlete_id: "a2", frequency: "biweekly", starts_on: "2026-10-07" }), // on today
        ],
      }),
      ask(8 * 60),
    );
    expect(out.map((l) => l.athleteFirstName)).toEqual(["Linnea"]);
  });

  it("says whether a briefing is cached, for this coach and this date only", async () => {
    const out = await getUpNext(
      ctx({
        athlete_lesson_slots: [slot({ id: "s1" }), slot({ id: "s2", athlete_id: "a2" })],
        pre_lesson_briefings: [
          { coach_id: "coach-1", athlete_id: "a1", lesson_date: DATE },
          { coach_id: "coach-2", athlete_id: "a2", lesson_date: DATE }, // someone else's
          { coach_id: "coach-1", athlete_id: "a2", lesson_date: "2026-10-06" }, // yesterday's
        ],
      }),
      ask(8 * 60),
    );
    expect(out.map((l) => [l.athleteFirstName, l.briefingCached])).toEqual([
      ["Tobias", true],
      ["Linnea", false],
    ]);
  });

  it("carries the coach's own active plan id, and null when there is none", async () => {
    const out = await getUpNext(
      ctx({
        athlete_lesson_slots: [slot({ id: "s1" }), slot({ id: "s2", athlete_id: "a2" })],
        plans: [
          { id: "p1", athlete_id: "a1", coach_id: "coach-1", kind: "plan", status: "active" },
          { id: "p9", athlete_id: "a2", coach_id: "coach-2", kind: "plan", status: "active" },
          { id: "p8", athlete_id: "a2", coach_id: "coach-1", kind: "plan", status: "draft" },
        ],
      }),
      ask(8 * 60),
    );
    expect(out.map((l) => l.activePlanId)).toEqual(["p1", null]);
  });

  it("shows only this coach's slots", async () => {
    const out = await getUpNext(
      ctx({ athlete_lesson_slots: [slot({ id: "s1" }), slot({ id: "s2", coach_id: "coach-2" })] }),
      ask(8 * 60),
    );
    expect(out.map((l) => l.slotId)).toEqual(["s1"]);
  });

  it("returns nothing for an account with no coach profile", async () => {
    const out = await getUpNext(
      {
        userId: "user-1",
        admin: fakeAdmin({ coach_profiles: [], athlete_lesson_slots: [slot()] }),
      },
      ask(8 * 60),
    );
    expect(out).toEqual([]);
  });

  it("is limited to three by default, and to what the client asks", async () => {
    const slots = [1, 2, 3, 4].map((n) =>
      slot({ id: `s${n}`, start_minute: (9 + n) * 60, end_minute: (9 + n) * 60 + 30 }),
    );
    expect(await getUpNext(ctx({ athlete_lesson_slots: slots }), ask(8 * 60))).toHaveLength(3);
    expect(
      await getUpNext(ctx({ athlete_lesson_slots: slots }), ask(8 * 60, { limit: 1 })),
    ).toHaveLength(1);
  });

  it("lets the Today widget ask for 20 lessons, and no more", () => {
    const parse = (limit: string) =>
      upNextInput.safeParse({ lessonDate: DATE, dayOfWeek: 3, currentMinute: 5, limit }).success;
    expect(parse("20")).toBe(true);
    expect(parse("21")).toBe(false);
    expect(parse("0")).toBe(false);
  });

  it("validates the client's clock", () => {
    expect(
      upNextInput.safeParse({ lessonDate: DATE, dayOfWeek: 3, currentMinute: 1440 }).success,
    ).toBe(false);
    expect(
      upNextInput.safeParse({ lessonDate: "10/07", dayOfWeek: 3, currentMinute: 5 }).success,
    ).toBe(false);
    expect(
      upNextInput.safeParse({ lessonDate: DATE, dayOfWeek: "3", currentMinute: "5" }).success,
    ).toBe(true);
  });
});
