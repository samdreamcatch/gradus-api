import { describe, expect, it } from "bun:test";
import type { ApnsConfig, ApnsOutcome, ApnsRequest } from "./apns.server";
import { nowInRinkTz } from "./lesson-reminders.server";
import { computeLessonWrapUpPrompts, WINDOW_MINUTES } from "./lesson-wrap-up-prompts.server";

type Row = Record<string, unknown>;

/** Row-store fake for the query shapes this module issues; the upsert honours UNIQUE(slot_id, lesson_date). */
function fakeDb(tables: Record<string, Row[]>) {
  const sent: Row[] = [...(tables.lesson_wrap_up_prompts_sent ?? [])];
  const query = (rows: Row[]) => {
    const self = {
      eq: (col: string, val: unknown) => query(rows.filter((r) => r[col] === val)),
      in: (col: string, vals: unknown[]) => query(rows.filter((r) => vals.includes(r[col]))),
      is: (col: string, val: unknown) => query(rows.filter((r) => (r[col] ?? null) === val)),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => void) =>
        resolve({ data: rows, error: null }),
    };
    return self;
  };
  const admin = {
    from: (table: string) => ({
      select: () => query(table === "lesson_wrap_up_prompts_sent" ? sent : (tables[table] ?? [])),
      upsert: (payload: Row[]) => ({
        select: () => {
          const inserted: Row[] = [];
          for (const row of payload) {
            if (sent.some((s) => s.slot_id === row.slot_id && s.lesson_date === row.lesson_date))
              continue;
            sent.push(row);
            inserted.push(row);
          }
          return Promise.resolve({ data: inserted, error: null });
        },
      }),
      delete: () => ({ in: () => Promise.resolve({ error: null }) }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { admin, sent };
}

/** An instant whose America/New_York wall clock is `hh:mm` on 2026-09-15 (a Tuesday, EDT). */
function rinkTime(hh: number, mm: number): Date {
  let guess = Date.UTC(2026, 8, 15, hh + 4, mm);
  for (let i = 0; i < 2; i += 1) {
    const { minutes } = nowInRinkTz(new Date(guess));
    guess += (hh * 60 + mm - minutes) * 60_000;
  }
  return new Date(guess);
}

const SLOT = {
  id: "slot-1",
  coach_id: "coach-1",
  athlete_id: "athlete-1",
  day_of_week: 2,
  start_minute: 9 * 60,
  end_minute: 10 * 60, // ends 10:00
  frequency: "weekly",
  weeks_of_month: [],
  starts_on: null,
};

const config: ApnsConfig = {
  teamId: "T",
  keyId: "K",
  privateKeyPem: "x",
  bundleId: "training.gradus.app",
  host: "https://apns.test",
};

function pushSpy() {
  const sent: ApnsRequest[] = [];
  const send = async (_c: ApnsConfig, req: ApnsRequest): Promise<ApnsOutcome> => {
    sent.push(req);
    return { ok: true, apnsId: null };
  };
  return { push: { config, send }, sent };
}

function baseTables(overrides: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    athlete_lesson_slots: [SLOT],
    lesson_slot_overrides: [],
    lesson_wrap_ups: [],
    coach_profiles: [{ id: "coach-1", user_id: "coach-user-1" }],
    athletes: [{ id: "athlete-1", first_name: "Nora", last_name: "Donaldson" }],
    device_tokens: [{ user_id: "coach-user-1", token: "coach-tok", platform: "ios" }],
    ...overrides,
  };
}

describe("computeLessonWrapUpPrompts", () => {
  it("prompts the coach once a lesson has just ended, with the wrap-ups route and the athlete's name", async () => {
    const { admin, sent: recorded } = fakeDb(baseTables());
    const { push, sent } = pushSpy();
    const result = await computeLessonWrapUpPrompts({ admin, push }, rinkTime(10, 3));
    expect(result).toEqual({ scanned: 1, prompted: 1, sent: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].token).toBe("coach-tok");
    expect(sent[0].payload.gradus).toEqual({
      type: "lesson_wrap_up",
      route: "coach/wrap-ups",
      v: 1,
    });
    expect((sent[0].payload.aps as { alert: { body: string } }).alert.body).toContain(
      "Nora Donaldson",
    );
    expect(sent[0].collapseId).toBe("wrapup:slot-1:2026-09-15");
    expect(recorded).toHaveLength(1);
  });

  it("ignores lessons still running, lessons that ended before the window, and other weekdays", async () => {
    const { push } = pushSpy();
    expect(
      await computeLessonWrapUpPrompts(
        { admin: fakeDb(baseTables()).admin, push },
        rinkTime(9, 30),
      ),
    ).toEqual({ scanned: 1, prompted: 0, sent: 0 });
    expect(
      await computeLessonWrapUpPrompts(
        { admin: fakeDb(baseTables()).admin, push },
        rinkTime(10, WINDOW_MINUTES),
      ),
    ).toEqual({ scanned: 1, prompted: 0, sent: 0 });
    const monday = fakeDb(baseTables({ athlete_lesson_slots: [{ ...SLOT, day_of_week: 1 }] }));
    expect(
      await computeLessonWrapUpPrompts({ admin: monday.admin, push }, rinkTime(10, 3)),
    ).toEqual({ scanned: 0, prompted: 0, sent: 0 });
  });

  it("dedupes across ticks, skips lessons the coach already wrapped up, and skips slots with no coach", async () => {
    const { push, sent } = pushSpy();
    const db = fakeDb(baseTables());
    expect(await computeLessonWrapUpPrompts({ admin: db.admin, push }, rinkTime(10, 1))).toEqual({
      scanned: 1,
      prompted: 1,
      sent: 1,
    });
    expect(await computeLessonWrapUpPrompts({ admin: db.admin, push }, rinkTime(10, 6))).toEqual({
      scanned: 1,
      prompted: 0,
      sent: 0,
    });
    expect(sent).toHaveLength(1);

    const wrapped = fakeDb(
      baseTables({
        lesson_wrap_ups: [
          { coach_id: "coach-1", athlete_id: "athlete-1", lesson_date: "2026-09-15" },
        ],
      }),
    );
    expect(
      await computeLessonWrapUpPrompts({ admin: wrapped.admin, push }, rinkTime(10, 3)),
    ).toEqual({ scanned: 1, prompted: 0, sent: 0 });

    const noCoach = fakeDb(baseTables({ athlete_lesson_slots: [{ ...SLOT, coach_id: null }] }));
    expect(
      await computeLessonWrapUpPrompts({ admin: noCoach.admin, push }, rinkTime(10, 3)),
    ).toEqual({ scanned: 0, prompted: 0, sent: 0 });
  });

  it("honours overrides: a canceled occurrence is skipped and a rescheduled end time is used", async () => {
    const { push } = pushSpy();
    const canceled = fakeDb(
      baseTables({
        lesson_slot_overrides: [
          {
            slot_id: "slot-1",
            occurrence_date: "2026-09-15",
            status: "canceled",
            start_minute: null,
            end_minute: null,
          },
        ],
      }),
    );
    expect(
      await computeLessonWrapUpPrompts({ admin: canceled.admin, push }, rinkTime(10, 3)),
    ).toEqual({ scanned: 1, prompted: 0, sent: 0 });

    const moved = fakeDb(
      baseTables({
        lesson_slot_overrides: [
          {
            slot_id: "slot-1",
            occurrence_date: "2026-09-15",
            status: "rescheduled",
            start_minute: 13 * 60,
            end_minute: 14 * 60,
          },
        ],
      }),
    );
    expect(await computeLessonWrapUpPrompts({ admin: moved.admin, push }, rinkTime(10, 3))).toEqual(
      { scanned: 1, prompted: 0, sent: 0 },
    );
    const movedLater = fakeDb(
      baseTables({
        lesson_slot_overrides: [
          {
            slot_id: "slot-1",
            occurrence_date: "2026-09-15",
            status: "rescheduled",
            start_minute: 13 * 60,
            end_minute: 14 * 60,
          },
        ],
      }),
    );
    expect(
      await computeLessonWrapUpPrompts({ admin: movedLater.admin, push }, rinkTime(14, 2)),
    ).toEqual({ scanned: 1, prompted: 1, sent: 1 });
  });

  it("skips a biweekly slot on its off week", async () => {
    const { push } = pushSpy();
    // Anchored on 2026-09-08 (the previous Tuesday): 09-15 is the off week, 09-22 is on.
    const biweekly = fakeDb(
      baseTables({
        athlete_lesson_slots: [{ ...SLOT, frequency: "biweekly", starts_on: "2026-09-08" }],
      }),
    );
    expect(
      await computeLessonWrapUpPrompts({ admin: biweekly.admin, push }, rinkTime(10, 3)),
    ).toEqual({ scanned: 1, prompted: 0, sent: 0 });
  });
});
