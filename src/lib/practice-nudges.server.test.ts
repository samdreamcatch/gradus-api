import { describe, expect, it } from "bun:test";
import { nowInRinkTz } from "./lesson-reminders.server";
import { MAX_PER_TICK, computePracticeNudges, nudgeMinute } from "./practice-nudges.server";
import type { PushDeps } from "./push-notify.server";

type Row = Record<string, unknown>;

/**
 * A minimal fake covering the query shapes `computePracticeNudges` and the
 * push helpers issue: `.select()` chained with `.eq/.in/.gte/.lte`, awaited
 * or `.maybeSingle()`, an `upsert(...).select()` that honors
 * UNIQUE(athlete_id, lesson_date), and `.delete().eq().eq()`.
 */
function fakeDb(tables: Record<string, Row[]>) {
  const sent: Row[] = [...(tables.practice_nudges_sent ?? [])];
  const rowsFor = (name: string) => (name === "practice_nudges_sent" ? sent : (tables[name] ?? []));

  const makeQuery = (rows: Row[]) => {
    const self = {
      eq: (col: string, val: unknown) => makeQuery(rows.filter((r) => r[col] === val)),
      in: (col: string, vals: unknown[]) => makeQuery(rows.filter((r) => vals.includes(r[col]))),
      gte: (col: string, val: string) => makeQuery(rows.filter((r) => String(r[col]) >= val)),
      lte: (col: string, val: string) => makeQuery(rows.filter((r) => String(r[col]) <= val)),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => void) =>
        resolve({ data: rows, error: null }),
    };
    return self;
  };

  const from = (name: string) => ({
    select: () => makeQuery(rowsFor(name)),
    upsert: (payload: Row[]) => ({
      select: () => {
        const inserted: Row[] = [];
        for (const row of payload) {
          const conflict = sent.some(
            (s) => s.athlete_id === row.athlete_id && s.lesson_date === row.lesson_date,
          );
          if (conflict) continue;
          sent.push(row);
          inserted.push(row);
        }
        return Promise.resolve({ data: inserted, error: null });
      },
    }),
    delete: () => {
      const filters: [string, unknown][] = [];
      const chain = {
        eq: (col: string, val: unknown) => {
          filters.push([col, val]);
          return chain;
        },
        then: (resolve: (v: { error: null }) => void) => {
          if (name === "practice_nudges_sent") {
            for (let i = sent.length - 1; i >= 0; i -= 1) {
              if (filters.every(([c, v]) => sent[i]![c] === v)) sent.splice(i, 1);
            }
          }
          resolve({ error: null });
        },
      };
      return chain;
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: { from } as any, sent };
}

/** A "now" whose America/New_York wall clock is `hh:mm` on Tuesday Sept 15 2026. */
function nowAtRinkTime(hh: number, mm: number): Date {
  let guess = Date.UTC(2026, 8, 15, hh + 4, mm); // EDT (UTC-4)
  for (let i = 0; i < 2; i += 1) {
    const { minutes } = nowInRinkTz(new Date(guess));
    const wanted = hh * 60 + mm;
    if (minutes === wanted) break;
    guess += (wanted - minutes) * 60_000;
  }
  return new Date(guess);
}

const LESSON_DATE = "2026-09-12"; // Saturday, three days before Tuesday Sept 15

const SATURDAY_SLOT: Row = {
  id: "slot-sat",
  coach_id: "coach-1",
  athlete_id: "athlete-1",
  day_of_week: 6,
  start_minute: 10 * 60,
  frequency: "weekly",
  weeks_of_month: [],
  starts_on: null,
};

/** An athlete with their own login and a primary parent, one active plan, no practice logged. */
function household(extra: Record<string, Row[]> = {}) {
  return {
    athlete_lesson_slots: [SATURDAY_SLOT],
    athletes: [
      { id: "athlete-1", user_id: "athlete-user", parent_id: "parent-1", first_name: "Nora" },
    ],
    parent_profiles: [{ id: "parent-1", user_id: "parent-user", subscription_status: null }],
    plans: [{ athlete_id: "athlete-1", kind: "plan", status: "active" }],
    plan_sessions: [],
    device_tokens: [
      { user_id: "athlete-user", token: "athlete-tok", platform: "ios" },
      { user_id: "parent-user", token: "parent-tok", platform: "ios" },
    ],
    ...extra,
  };
}

function recordingPush() {
  const pushes: { token: string; route: string; type: string; title: string; body: string }[] = [];
  const push: PushDeps = {
    config: {
      teamId: "T",
      keyId: "K",
      privateKeyPem: "unused",
      bundleId: "training.gradus.app",
      host: "https://apns.test",
    },
    send: async (_config, req) => {
      const gradus = req.payload.gradus as { route: string; type: string };
      const alert = (req.payload.aps as { alert: { title: string; body: string } }).alert;
      pushes.push({ token: req.token, route: gradus.route, type: gradus.type, ...alert });
      return { ok: true, apnsId: null };
    },
  };
  return { push, pushes };
}

describe("computePracticeNudges", () => {
  it("nudges the athlete and their parent three days after the lesson, at its start time", async () => {
    const { admin, sent } = fakeDb(household());
    const { push, pushes } = recordingPush();
    const result = await computePracticeNudges({ admin, push }, nowAtRinkTime(10, 0));
    expect(result).toEqual({ scanned: 1, prompted: 1, sent: 2 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ athlete_id: "athlete-1", lesson_date: LESSON_DATE });
    expect(pushes).toEqual([
      {
        token: "athlete-tok",
        route: "plans",
        type: "practice_nudge",
        title: "Time to practice?",
        body: "It's been 3 days since your lesson. Log a practice session to keep your plan moving.",
      },
      {
        token: "parent-tok",
        route: "plans",
        type: "practice_nudge",
        title: "Time to practice?",
        body: "It's been 3 days since Nora's lesson. Log a practice session to keep their plan moving.",
      },
    ]);
  });

  it("waits for the lesson's start time", async () => {
    const { admin } = fakeDb(household());
    const result = await computePracticeNudges({ admin }, nowAtRinkTime(9, 55));
    expect(result).toEqual({ scanned: 0, prompted: 0, sent: 0 });
  });

  it("holds an early-morning lesson's nudge until 08:00", async () => {
    const early = { ...SATURDAY_SLOT, start_minute: 6 * 60 };
    const before = fakeDb(household({ athlete_lesson_slots: [early] }));
    expect(
      (await computePracticeNudges({ admin: before.admin }, nowAtRinkTime(7, 55))).scanned,
    ).toBe(0);
    const at = fakeDb(household({ athlete_lesson_slots: [early] }));
    expect((await computePracticeNudges({ admin: at.admin }, nowAtRinkTime(8, 0))).prompted).toBe(
      1,
    );
  });

  it("clamps the send time to 08:00-20:00", () => {
    expect(nudgeMinute(6 * 60)).toBe(8 * 60);
    expect(nudgeMinute(16 * 60 + 30)).toBe(16 * 60 + 30);
    expect(nudgeMinute(21 * 60)).toBe(20 * 60);
  });

  it("skips an athlete who logged practice since the lesson", async () => {
    const now = nowAtRinkTime(10, 0);
    const { admin, sent } = fakeDb(
      household({
        plan_sessions: [
          {
            athlete_id: "athlete-1",
            logged_at: new Date(now.getTime() - 86_400_000).toISOString(),
          },
        ],
      }),
    );
    const result = await computePracticeNudges({ admin }, now);
    expect(result).toEqual({ scanned: 1, prompted: 0, sent: 0 });
    expect(sent).toHaveLength(0);
  });

  it("still nudges when the only practice logged was before the lesson", async () => {
    const now = nowAtRinkTime(10, 0);
    const { admin } = fakeDb(
      household({
        plan_sessions: [
          {
            athlete_id: "athlete-1",
            logged_at: new Date(now.getTime() - 4 * 86_400_000).toISOString(),
          },
        ],
      }),
    );
    expect((await computePracticeNudges({ admin }, now)).prompted).toBe(1);
  });

  it("skips an athlete who has had another lesson since", async () => {
    const monday = { ...SATURDAY_SLOT, id: "slot-mon", day_of_week: 1, start_minute: 17 * 60 };
    const { admin } = fakeDb(household({ athlete_lesson_slots: [SATURDAY_SLOT, monday] }));
    const result = await computePracticeNudges({ admin }, nowAtRinkTime(10, 0));
    expect(result).toEqual({ scanned: 1, prompted: 0, sent: 0 });
  });

  it("still nudges when the next lesson is later today and hasn't started", async () => {
    const tuesday = { ...SATURDAY_SLOT, id: "slot-tue", day_of_week: 2, start_minute: 18 * 60 };
    const { admin } = fakeDb(household({ athlete_lesson_slots: [SATURDAY_SLOT, tuesday] }));
    expect((await computePracticeNudges({ admin }, nowAtRinkTime(10, 0))).prompted).toBe(1);
  });

  it("does not count a canceled lesson since as a lesson", async () => {
    const monday = { ...SATURDAY_SLOT, id: "slot-mon", day_of_week: 1, start_minute: 17 * 60 };
    const { admin } = fakeDb(
      household({
        athlete_lesson_slots: [SATURDAY_SLOT, monday],
        lesson_slot_overrides: [
          {
            slot_id: "slot-mon",
            occurrence_date: "2026-09-14",
            status: "canceled",
            start_minute: null,
          },
        ],
      }),
    );
    expect((await computePracticeNudges({ admin }, nowAtRinkTime(10, 0))).prompted).toBe(1);
  });

  it("skips a lesson that was canceled", async () => {
    const { admin } = fakeDb(
      household({
        lesson_slot_overrides: [
          {
            slot_id: "slot-sat",
            occurrence_date: LESSON_DATE,
            status: "canceled",
            start_minute: null,
          },
        ],
      }),
    );
    expect(await computePracticeNudges({ admin }, nowAtRinkTime(10, 0))).toEqual({
      scanned: 0,
      prompted: 0,
      sent: 0,
    });
  });

  it("times the nudge from a rescheduled start", async () => {
    const tables = household({
      lesson_slot_overrides: [
        {
          slot_id: "slot-sat",
          occurrence_date: LESSON_DATE,
          status: "rescheduled",
          start_minute: 14 * 60,
        },
      ],
    });
    expect(
      (await computePracticeNudges({ admin: fakeDb(tables).admin }, nowAtRinkTime(10, 0))).scanned,
    ).toBe(0);
    expect(
      (await computePracticeNudges({ admin: fakeDb(tables).admin }, nowAtRinkTime(14, 0))).prompted,
    ).toBe(1);
  });

  it("times the nudge from the later of two lessons that day", async () => {
    const afternoon = { ...SATURDAY_SLOT, id: "slot-sat-pm", start_minute: 15 * 60 };
    const tables = household({ athlete_lesson_slots: [SATURDAY_SLOT, afternoon] });
    expect(
      (await computePracticeNudges({ admin: fakeDb(tables).admin }, nowAtRinkTime(10, 0))).scanned,
    ).toBe(0);
    expect(
      (await computePracticeNudges({ admin: fakeDb(tables).admin }, nowAtRinkTime(15, 0))).prompted,
    ).toBe(1);
  });

  it("ignores a slot whose coach was unlinked", async () => {
    const { admin } = fakeDb(
      household({ athlete_lesson_slots: [{ ...SATURDAY_SLOT, coach_id: null }] }),
    );
    expect((await computePracticeNudges({ admin }, nowAtRinkTime(10, 0))).scanned).toBe(0);
  });

  it("ignores lessons from before the slot was created", async () => {
    // Created Sunday for Saturdays: there was no lesson on the Saturday before.
    const created = { ...SATURDAY_SLOT, created_at: "2026-09-13T15:00:00Z" };
    const { admin } = fakeDb(household({ athlete_lesson_slots: [created] }));
    expect((await computePracticeNudges({ admin }, nowAtRinkTime(10, 0))).scanned).toBe(0);
  });

  it("doesn't count a lesson since from before its slot existed", async () => {
    const monday = {
      ...SATURDAY_SLOT,
      id: "slot-mon",
      day_of_week: 1,
      start_minute: 17 * 60,
      created_at: "2026-09-15T12:00:00Z", // added this morning, after Monday
    };
    const { admin } = fakeDb(household({ athlete_lesson_slots: [SATURDAY_SLOT, monday] }));
    expect((await computePracticeNudges({ admin }, nowAtRinkTime(10, 0))).prompted).toBe(1);
  });

  it("treats practice logged just before the lesson as before, and just after as since", async () => {
    const now = nowAtRinkTime(10, 0);
    const lessonStart = now.getTime() - 3 * 86_400_000; // EDT throughout, no DST change
    const at = (ms: number) =>
      household({
        plan_sessions: [{ athlete_id: "athlete-1", logged_at: new Date(ms).toISOString() }],
      });
    const before = fakeDb(at(lessonStart - 60_000));
    expect((await computePracticeNudges({ admin: before.admin }, now)).prompted).toBe(1);
    const after = fakeDb(at(lessonStart + 60_000));
    expect((await computePracticeNudges({ admin: after.admin }, now)).prompted).toBe(0);
  });

  it("skips a paused athlete login but still nudges the guardians", async () => {
    const { admin } = fakeDb(
      household({
        athletes: [
          {
            id: "athlete-1",
            user_id: "athlete-user",
            parent_id: "parent-1",
            first_name: "Nora",
            account_state: "paused",
          },
        ],
      }),
    );
    const { push, pushes } = recordingPush();
    await computePracticeNudges({ admin, push }, nowAtRinkTime(10, 0));
    expect(pushes.map((p) => p.token)).toEqual(["parent-tok"]);
  });

  it("caps the athletes nudged per tick and leaves the rest for the next one", async () => {
    const ids = Array.from({ length: MAX_PER_TICK + 3 }, (_, i) => `a${i}`);
    const tables = {
      athlete_lesson_slots: ids.map((id) => ({
        ...SATURDAY_SLOT,
        id: `slot-${id}`,
        athlete_id: id,
      })),
      athletes: ids.map((id) => ({ id, user_id: null, parent_id: null, first_name: "X" })),
      plans: ids.map((id) => ({ athlete_id: id, kind: "plan", status: "active" })),
    };
    const { admin, sent } = fakeDb(tables);
    expect((await computePracticeNudges({ admin }, nowAtRinkTime(10, 0))).prompted).toBe(
      MAX_PER_TICK,
    );
    expect((await computePracticeNudges({ admin }, nowAtRinkTime(10, 15))).prompted).toBe(3);
    expect(sent).toHaveLength(MAX_PER_TICK + 3);
  });

  it("skips an athlete with no active plan", async () => {
    const { admin } = fakeDb(
      household({ plans: [{ athlete_id: "athlete-1", kind: "plan", status: "benched" }] }),
    );
    expect(await computePracticeNudges({ admin }, nowAtRinkTime(10, 0))).toEqual({
      scanned: 1,
      prompted: 0,
      sent: 0,
    });
  });

  it("nudges once per lesson across ticks", async () => {
    const { admin, sent } = fakeDb(household());
    expect((await computePracticeNudges({ admin }, nowAtRinkTime(10, 0))).prompted).toBe(1);
    expect((await computePracticeNudges({ admin }, nowAtRinkTime(10, 15))).prompted).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("nudges only the parent when the athlete has no login of their own", async () => {
    const { admin } = fakeDb(
      household({
        athletes: [{ id: "athlete-1", user_id: null, parent_id: "parent-1", first_name: "Nora" }],
      }),
    );
    const { push, pushes } = recordingPush();
    await computePracticeNudges({ admin, push }, nowAtRinkTime(10, 0));
    expect(pushes.map((p) => p.token)).toEqual(["parent-tok"]);
  });

  it("releases the dedupe row when every push failed transiently", async () => {
    const { admin, sent } = fakeDb(household());
    const { push } = recordingPush();
    push.send = async () => ({ ok: false, status: 503, reason: "ServiceUnavailable", dead: false });
    const result = await computePracticeNudges({ admin, push }, nowAtRinkTime(10, 0));
    expect(result).toEqual({ scanned: 1, prompted: 1, sent: 0 });
    expect(sent).toHaveLength(0);
  });
});
