import { describe, expect, it } from "bun:test";
import { computeLessonReminders, nowInRinkTz } from "./lesson-reminders.server";

type SlotRow = {
  id: string;
  coach_id: string | null;
  athlete_id: string;
  day_of_week: number;
  start_minute: number;
  end_minute: number;
  frequency: string;
  weeks_of_month: number[];
  starts_on: string | null;
};

type OverrideRow = {
  slot_id: string;
  occurrence_date: string;
  status: string;
  start_minute: number | null;
  end_minute: number | null;
};

type SentRow = {
  slot_id: string;
  athlete_id: string;
  coach_id: string;
  lesson_date: string;
  sent_at: string | null;
};

type Coach = { id: string; user_id: string | null };
type Athlete = {
  id: string;
  user_id: string | null;
  self_managed: boolean;
  parent_id: string | null;
};
type Parent = { id: string; user_id: string };
type DeviceToken = { user_id: string; token: string; platform: string };

/**
 * A minimal fake covering exactly the query shapes
 * `computeLessonReminders` issues: `.select().eq()`,
 * `.select().in().eq()`, and an `upsert(rows, { onConflict,
 * ignoreDuplicates }).select()` that honors the same UNIQUE(slot_id,
 * lesson_date) constraint the real migration declares — a conflicting row
 * is silently dropped from what comes back, never thrown.
 */
function fakeDb(opts: {
  slots: SlotRow[];
  overrides?: OverrideRow[];
  alreadySent?: SentRow[];
  coaches?: Coach[];
  athletes?: Athlete[];
  parents?: Parent[];
  deviceTokens?: DeviceToken[];
}) {
  const sent: SentRow[] = [...(opts.alreadySent ?? [])];

  const table = (name: string) => {
    const rowsFor = (): unknown[] => {
      switch (name) {
        case "athlete_lesson_slots":
          return opts.slots;
        case "lesson_slot_overrides":
          return opts.overrides ?? [];
        case "lesson_reminders_sent":
          return sent;
        case "coach_profiles":
          return opts.coaches ?? [];
        case "athletes":
          return opts.athletes ?? [];
        case "parent_profiles":
          return opts.parents ?? [];
        case "device_tokens":
          return opts.deviceTokens ?? [];
        default:
          return [];
      }
    };

    const makeQuery = (rows: unknown[]) => {
      const self = {
        eq: (col: string, val: unknown) =>
          makeQuery(rows.filter((r) => (r as Record<string, unknown>)[col] === val)),
        in: (col: string, vals: unknown[]) =>
          makeQuery(rows.filter((r) => vals.includes((r as Record<string, unknown>)[col]))),
        then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
          resolve({ data: rows, error: null }),
      };
      return self;
    };

    return {
      select: () => makeQuery(rowsFor()),
      upsert: (
        payload: Record<string, unknown>[],
        _opts: { onConflict: string; ignoreDuplicates: boolean },
      ) => ({
        select: (_cols: string) => {
          const inserted: Record<string, unknown>[] = [];
          for (const row of payload) {
            const conflict = sent.some(
              (s) => s.slot_id === row.slot_id && s.lesson_date === row.lesson_date,
            );
            if (conflict) continue; // ON CONFLICT DO NOTHING: silently dropped, no error
            sent.push(row as SentRow);
            inserted.push(row);
          }
          return Promise.resolve({ data: inserted, error: null });
        },
      }),
    };
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = { from: table } as any;
  return { admin, sent };
}

/** A "now" whose America/New_York wall clock is exactly `hh:mm` today. */
function nowAtRinkTime(hh: number, mm: number): Date {
  // Find an instant, then read back its RINK_TZ wall clock, and correct once
  // — mirrors the correction loop `ijs-scrape.server.ts` uses.
  let guess = Date.UTC(2026, 8, 15, hh + 4, mm); // Sept 15 2026 is EDT (UTC-4)
  for (let i = 0; i < 2; i += 1) {
    const { minutes } = nowInRinkTz(new Date(guess));
    const wanted = hh * 60 + mm;
    if (minutes === wanted) break;
    guess += (wanted - minutes) * 60_000;
  }
  return new Date(guess);
}

const BASE_SLOT: SlotRow = {
  id: "slot-1",
  coach_id: "coach-1",
  athlete_id: "athlete-1",
  day_of_week: 2, // Tuesday — Sept 15 2026 is a Tuesday
  start_minute: 0,
  end_minute: 0,
  frequency: "weekly",
  weeks_of_month: [],
  starts_on: null,
};

describe("computeLessonReminders", () => {
  it("finds an occurrence exactly 60 minutes out", async () => {
    const now = nowAtRinkTime(9, 0);
    const slot = { ...BASE_SLOT, start_minute: 10 * 60 }; // 10:00, 60 min out
    const { admin } = fakeDb({
      slots: [slot],
      coaches: [{ id: "coach-1", user_id: null }],
      athletes: [{ id: "athlete-1", user_id: null, self_managed: false, parent_id: null }],
    });
    const result = await computeLessonReminders({ admin }, now);
    expect(result).toEqual({ scanned: 1, wouldSend: 1 });
  });

  it("does not find an occurrence 30 minutes out", async () => {
    const now = nowAtRinkTime(9, 0);
    const slot = { ...BASE_SLOT, start_minute: 9 * 60 + 30 };
    const { admin } = fakeDb({ slots: [slot] });
    const result = await computeLessonReminders({ admin }, now);
    expect(result).toEqual({ scanned: 0, wouldSend: 0 });
  });

  it("does not find an occurrence 90 minutes out", async () => {
    const now = nowAtRinkTime(9, 0);
    const slot = { ...BASE_SLOT, start_minute: 10 * 60 + 30 };
    const { admin } = fakeDb({ slots: [slot] });
    const result = await computeLessonReminders({ admin }, now);
    expect(result).toEqual({ scanned: 0, wouldSend: 0 });
  });

  it("does not double-upsert on a re-run within the same tick window", async () => {
    const now = nowAtRinkTime(9, 0);
    const slot = { ...BASE_SLOT, start_minute: 10 * 60 };
    const { admin, sent } = fakeDb({
      slots: [slot],
      coaches: [{ id: "coach-1", user_id: null }],
      athletes: [{ id: "athlete-1", user_id: null, self_managed: false, parent_id: null }],
    });

    const first = await computeLessonReminders({ admin }, now);
    expect(first).toEqual({ scanned: 1, wouldSend: 1 });
    expect(sent).toHaveLength(1);

    const second = await computeLessonReminders({ admin }, now);
    expect(second).toEqual({ scanned: 1, wouldSend: 0 });
    expect(sent).toHaveLength(1);
  });

  it("skips an occurrence canceled by an override", async () => {
    const now = nowAtRinkTime(9, 0);
    const slot = { ...BASE_SLOT, start_minute: 10 * 60 };
    const { dateIso } = nowInRinkTz(now);
    const { admin } = fakeDb({
      slots: [slot],
      overrides: [
        {
          slot_id: "slot-1",
          occurrence_date: dateIso,
          status: "canceled",
          start_minute: null,
          end_minute: null,
        },
      ],
    });
    const result = await computeLessonReminders({ admin }, now);
    expect(result).toEqual({ scanned: 0, wouldSend: 0 });
  });

  it("uses a rescheduled override's start_minute instead of the slot's own", async () => {
    const now = nowAtRinkTime(9, 0);
    // Slot's own time is 90 min out (would be skipped); the override moves
    // it to 60 min out.
    const slot = { ...BASE_SLOT, start_minute: 10 * 60 + 30 };
    const { dateIso } = nowInRinkTz(now);
    const { admin } = fakeDb({
      slots: [slot],
      overrides: [
        {
          slot_id: "slot-1",
          occurrence_date: dateIso,
          status: "rescheduled",
          start_minute: 10 * 60,
          end_minute: 11 * 60,
        },
      ],
      coaches: [{ id: "coach-1", user_id: null }],
      athletes: [{ id: "athlete-1", user_id: null, self_managed: false, parent_id: null }],
    });
    const result = await computeLessonReminders({ admin }, now);
    expect(result).toEqual({ scanned: 1, wouldSend: 1 });
  });

  it("still records the dedupe row when neither recipient has a device token", async () => {
    const now = nowAtRinkTime(9, 0);
    const slot = { ...BASE_SLOT, start_minute: 10 * 60 };
    const { admin, sent } = fakeDb({
      slots: [slot],
      coaches: [{ id: "coach-1", user_id: "coach-user-1" }],
      athletes: [{ id: "athlete-1", user_id: null, self_managed: false, parent_id: "parent-1" }],
      parents: [{ id: "parent-1", user_id: "parent-user-1" }],
      deviceTokens: [], // no tokens registered for anyone
    });
    const result = await computeLessonReminders({ admin }, now);
    expect(result).toEqual({ scanned: 1, wouldSend: 1 });
    expect(sent).toHaveLength(1);
  });

  it("resolves the coach's own user_id and a self-managed athlete's own user_id (not a parent)", async () => {
    const logs: unknown[][] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args);
    try {
      const now = nowAtRinkTime(9, 0);
      const slot = { ...BASE_SLOT, start_minute: 10 * 60 };
      const { admin } = fakeDb({
        slots: [slot],
        coaches: [{ id: "coach-1", user_id: "coach-user-1" }],
        athletes: [
          { id: "athlete-1", user_id: "athlete-user-1", self_managed: true, parent_id: null },
        ],
        deviceTokens: [
          { user_id: "coach-user-1", token: "coach-tok", platform: "ios" },
          { user_id: "athlete-user-1", token: "athlete-tok", platform: "ios" },
        ],
      });
      await computeLessonReminders({ admin }, now);
      const line = logs.find((l) => l[0] === "[api] lesson-reminders would-send");
      expect(line).toBeDefined();
      const payload = JSON.parse(line![1] as string);
      expect(payload.coach.userId).toBe("coach-user-1");
      expect(payload.coach.tokenCount).toBe(1);
      expect(payload.coach.payload).toEqual({
        gradus: { type: "lesson_reminder", route: "roster", v: 1 },
      });
      expect(payload.recipient.userId).toBe("athlete-user-1");
      expect(payload.recipient.tokenCount).toBe(1);
      expect(payload.recipient.payload).toEqual({
        gradus: { type: "lesson_reminder", route: "plans", v: 1 },
      });
    } finally {
      console.log = originalLog;
    }
  });

  it("resolves a non-self-managed athlete's recipient to their parent's user_id", async () => {
    const logs: unknown[][] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args);
    try {
      const now = nowAtRinkTime(9, 0);
      const slot = { ...BASE_SLOT, start_minute: 10 * 60 };
      const { admin } = fakeDb({
        slots: [slot],
        coaches: [{ id: "coach-1", user_id: "coach-user-1" }],
        athletes: [{ id: "athlete-1", user_id: null, self_managed: false, parent_id: "parent-1" }],
        parents: [{ id: "parent-1", user_id: "parent-user-1" }],
      });
      await computeLessonReminders({ admin }, now);
      const line = logs.find((l) => l[0] === "[api] lesson-reminders would-send");
      const payload = JSON.parse(line![1] as string);
      expect(payload.recipient.userId).toBe("parent-user-1");
      expect(payload.recipient.payload.gradus.route).toBe("plans");
      expect(payload.coach.payload.gradus.route).toBe("roster");
    } finally {
      console.log = originalLog;
    }
  });

  it("ignores a biweekly slot on an off week even though it matches today's weekday", async () => {
    const now = nowAtRinkTime(9, 0);
    const { dateIso } = nowInRinkTz(now);
    // Anchor the slot's biweekly cycle one week after today, so today falls
    // on the "off" week.
    const anchor = new Date(dateIso + "T12:00:00");
    anchor.setDate(anchor.getDate() + 7);
    const startsOn = anchor.toISOString().slice(0, 10);
    const slot = {
      ...BASE_SLOT,
      start_minute: 10 * 60,
      frequency: "biweekly",
      starts_on: startsOn,
    };
    const { admin } = fakeDb({ slots: [slot] });
    const result = await computeLessonReminders({ admin }, now);
    expect(result).toEqual({ scanned: 0, wouldSend: 0 });
  });
});

describe("nowInRinkTz", () => {
  it("returns a day-of-week consistent with the calendar date it reports", () => {
    const { dateIso, dayOfWeek } = nowInRinkTz(new Date());
    const [y, m, d] = dateIso.split("-").map(Number);
    expect(new Date(y!, m! - 1, d!).getDay()).toBe(dayOfWeek);
  });
});
