import { describe, expect, it } from "bun:test";
import type { ApnsConfig, ApnsOutcome, ApnsRequest } from "./apns.server";
import { nowInRinkTz } from "./lesson-reminders.server";
import { computeLessonWrapUpPrompts, WINDOW_MINUTES } from "./lesson-wrap-up-prompts.server";

type Row = Record<string, unknown>;

/** Row-store fake for the query shapes this module issues; the upsert honours UNIQUE(slot_id, lesson_date). */
function fakeDb(tables: Record<string, Row[]>, opts: { noGroupColumn?: boolean } = {}) {
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
      select: (columns?: string) => {
        // Before migration 20261115120000 the column does not exist: Postgres says 42703.
        if (
          opts.noGroupColumn &&
          table === "athlete_lesson_slots" &&
          columns?.includes("group_id")
        ) {
          const failed = {
            eq: () => failed,
            in: () => failed,
            then: (
              resolve: (v: { data: null; error: { code: string; message: string } }) => void,
            ) =>
              resolve({ data: null, error: { code: "42703", message: "column does not exist" } }),
          };
          return failed;
        }
        if (opts.noGroupColumn && table === "athlete_lesson_slots") {
          // The column is not there to read: rows come back without it.
          return query((tables[table] ?? []).map(({ group_id: _gone, ...rest }) => rest));
        }
        return query(table === "lesson_wrap_up_prompts_sent" ? sent : (tables[table] ?? []));
      },
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
      delete: () => ({
        in: () => Promise.resolve({ error: null }),
        eq: (colA: string, a: unknown) => ({
          eq: (colB: string, b: unknown) => {
            if (table === "lesson_wrap_up_prompts_sent") {
              for (let i = sent.length - 1; i >= 0; i -= 1) {
                if (sent[i][colA] === a && sent[i][colB] === b) sent.splice(i, 1);
              }
            }
            return Promise.resolve({ error: null });
          },
        }),
      }),
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
    athletes: [{ id: "athlete-1", first_name: "Greta", last_name: "Halvorsen" }],
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
      uid: "coach-user-1",
    });
    expect((sent[0].payload.aps as { alert: { body: string } }).alert.body).toContain(
      "Greta Halvorsen",
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

  it("honours overrides: canceled is skipped; rescheduled prompts when it actually ends, later or earlier", async () => {
    const { push } = pushSpy();
    const override = (start_minute: number, end_minute: number, status = "rescheduled") => ({
      lesson_slot_overrides: [
        { slot_id: "slot-1", occurrence_date: "2026-09-15", status, start_minute, end_minute },
      ],
    });
    const canceled = fakeDb(baseTables(override(0, 0, "canceled")));
    expect(
      await computeLessonWrapUpPrompts({ admin: canceled.admin, push }, rinkTime(10, 3)),
    ).toEqual({ scanned: 1, prompted: 0, sent: 0 });

    // Moved to 13:00-14:00: nothing at the old end, prompt at the new one.
    expect(
      await computeLessonWrapUpPrompts(
        { admin: fakeDb(baseTables(override(13 * 60, 14 * 60))).admin, push },
        rinkTime(10, 3),
      ),
    ).toEqual({ scanned: 1, prompted: 0, sent: 0 });
    expect(
      await computeLessonWrapUpPrompts(
        { admin: fakeDb(baseTables(override(13 * 60, 14 * 60))).admin, push },
        rinkTime(14, 2),
      ),
    ).toEqual({ scanned: 1, prompted: 1, sent: 1 });

    // Moved to 07:00-08:00: prompt at 08:03 (the card shows from 08:00), nothing at the old end.
    expect(
      await computeLessonWrapUpPrompts(
        { admin: fakeDb(baseTables(override(7 * 60, 8 * 60))).admin, push },
        rinkTime(8, 3),
      ),
    ).toEqual({ scanned: 1, prompted: 1, sent: 1 });
    expect(
      await computeLessonWrapUpPrompts(
        { admin: fakeDb(baseTables(override(7 * 60, 8 * 60))).admin, push },
        rinkTime(10, 3),
      ),
    ).toEqual({ scanned: 1, prompted: 0, sent: 0 });
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

  describe("group lessons (GL4, decision #68)", () => {
    const member = (n: number, over: Row = {}): Row => ({
      ...SLOT,
      id: `slot-${n}`,
      athlete_id: `athlete-${n}`,
      group_id: "group-1",
      ...over,
    });
    const groupTables = (overrides: Partial<Record<string, Row[]>> = {}) =>
      baseTables({
        athlete_lesson_slots: [member(1), member(2), member(3)],
        athletes: [
          { id: "athlete-1", first_name: "Greta", last_name: "Halvorsen" },
          { id: "athlete-2", first_name: "Tobin", last_name: "Ashcombe" },
          { id: "athlete-3", first_name: "Ines", last_name: "Marlowe" },
        ],
        ...overrides,
      });
    const body = (req: ApnsRequest) => (req.payload.aps as { alert: { body: string } }).alert.body;

    it("sends one push for the whole group, records every member, and stays quiet on the next tick", async () => {
      const db = fakeDb(groupTables());
      const { push, sent } = pushSpy();
      expect(await computeLessonWrapUpPrompts({ admin: db.admin, push }, rinkTime(10, 1))).toEqual({
        scanned: 3,
        prompted: 1,
        sent: 1,
      });
      expect(sent).toHaveLength(1);
      expect(body(sent[0])).toBe(
        "Group lesson with Greta, Ines, Tobin just ended. Edit, redeploy, or dismiss their plans.",
      );
      expect(sent[0].collapseId).toBe("wrapup:group:group-1:2026-09-15:600");
      expect(db.sent.map((r) => r.slot_id).sort()).toEqual(["slot-1", "slot-2", "slot-3"]);

      expect(await computeLessonWrapUpPrompts({ admin: db.admin, push }, rinkTime(10, 6))).toEqual({
        scanned: 3,
        prompted: 0,
        sent: 0,
      });
      expect(sent).toHaveLength(1);
    });

    it("a group of eight is one push, three names then +5", async () => {
      const slots = Array.from({ length: 8 }, (_, i) => member(i + 1));
      const names = ["Greta", "Tobin", "Ines", "Wren", "Odette", "Maeve", "Calla", "Bram"];
      const db = fakeDb(
        groupTables({
          athlete_lesson_slots: slots,
          athletes: names.map((first_name, i) => ({
            id: `athlete-${i + 1}`,
            first_name,
            last_name: "Example",
          })),
        }),
      );
      const { push, sent } = pushSpy();
      expect(await computeLessonWrapUpPrompts({ admin: db.admin, push }, rinkTime(10, 2))).toEqual({
        scanned: 8,
        prompted: 1,
        sent: 1,
      });
      expect(body(sent[0])).toContain("Group lesson with Bram, Calla, Greta +5 just ended");
    });

    it("leaves out members who are out today or already wrapped up; one left reads as their own lesson", async () => {
      const out = fakeDb(
        groupTables({
          lesson_slot_overrides: [
            {
              slot_id: "slot-3",
              occurrence_date: "2026-09-15",
              status: "canceled",
              start_minute: null,
              end_minute: null,
            },
          ],
        }),
      );
      const first = pushSpy();
      await computeLessonWrapUpPrompts({ admin: out.admin, push: first.push }, rinkTime(10, 2));
      expect(first.sent).toHaveLength(1);
      expect(body(first.sent[0])).toContain("Group lesson with Greta, Tobin just ended");

      const wrapped = fakeDb(
        groupTables({
          lesson_wrap_ups: [
            { coach_id: "coach-1", athlete_id: "athlete-1", lesson_date: "2026-09-15" },
            { coach_id: "coach-1", athlete_id: "athlete-3", lesson_date: "2026-09-15" },
          ],
        }),
      );
      const second = pushSpy();
      await computeLessonWrapUpPrompts(
        { admin: wrapped.admin, push: second.push },
        rinkTime(10, 2),
      );
      expect(second.sent).toHaveLength(1);
      expect(body(second.sent[0])).toBe(
        "Tobin Ashcombe's lesson just ended. Edit, redeploy, or dismiss their plan.",
      );
      expect(second.sent[0].collapseId).toBe("wrapup:slot-2:2026-09-15");
    });

    it("stays out of the inbox, and a send that fails releases every member so the next tick retries", async () => {
      const db = fakeDb(groupTables());
      const sent: ApnsRequest[] = [];
      let fail = true;
      const send = async (_c: ApnsConfig, req: ApnsRequest): Promise<ApnsOutcome> => {
        if (fail) return { ok: false, status: 503, reason: "ServiceUnavailable", dead: false };
        sent.push(req);
        return { ok: true, apnsId: null };
      };
      const push = { config, send };
      const first = await computeLessonWrapUpPrompts({ admin: db.admin, push }, rinkTime(10, 1));
      expect(first.sent).toBe(0);
      expect(db.sent).toHaveLength(0);
      fail = false;
      const second = await computeLessonWrapUpPrompts({ admin: db.admin, push }, rinkTime(10, 4));
      expect(second).toEqual({ scanned: 3, prompted: 1, sent: 1 });
      expect(body(sent[0])).toContain("Greta, Ines, Tobin");
      expect(db.sent).toHaveLength(3);
    });

    it("before the group migration every lesson prompts on its own, as it always did", async () => {
      const db = fakeDb(groupTables(), { noGroupColumn: true });
      const { push, sent } = pushSpy();
      expect(await computeLessonWrapUpPrompts({ admin: db.admin, push }, rinkTime(10, 2))).toEqual({
        scanned: 3,
        prompted: 3,
        sent: 3,
      });
      expect(sent.every((r) => body(r).includes("'s lesson just ended"))).toBe(true);
    });

    it("a lone leftover group link and two different groups each prompt on their own", async () => {
      const db = fakeDb(
        groupTables({
          athlete_lesson_slots: [member(1), member(2), member(3, { group_id: "group-lone" })],
        }),
      );
      const { push, sent } = pushSpy();
      expect(await computeLessonWrapUpPrompts({ admin: db.admin, push }, rinkTime(10, 2))).toEqual({
        scanned: 3,
        prompted: 2,
        sent: 2,
      });
      expect(sent.map(body).sort()).toEqual([
        "Group lesson with Greta, Tobin just ended. Edit, redeploy, or dismiss their plans.",
        "Ines Marlowe's lesson just ended. Edit, redeploy, or dismiss their plan.",
      ]);
    });
  });
});
