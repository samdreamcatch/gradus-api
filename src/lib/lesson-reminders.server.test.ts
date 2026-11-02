import { describe, expect, it } from "bun:test";
import { computeLessonReminders, nowInRinkTz } from "./lesson-reminders.server";
import { addDays, parseIsoDate, toIsoDate } from "./lesson-recurrence";

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
  coach_id: string | null;
  lesson_date: string;
  sent_at: string | null;
};

type Coach = { id: string; user_id: string | null };
type Athlete = { id: string; first_name: string | null };
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
      delete: () => {
        const filters: [string, unknown][] = [];
        const chain = {
          eq: (col: string, val: unknown) => {
            filters.push([col, val]);
            return chain;
          },
          then: (resolve: (v: { error: null }) => void) => {
            if (name === "lesson_reminders_sent") {
              for (let i = sent.length - 1; i >= 0; i -= 1) {
                const row = sent[i] as unknown as Record<string, unknown>;
                if (filters.every(([c, v]) => row[c] === v)) sent.splice(i, 1);
              }
            }
            resolve({ error: null });
          },
        };
        return chain;
      },
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
  it("finds an occurrence exactly 15 minutes out", async () => {
    const now = nowAtRinkTime(9, 0);
    const slot = { ...BASE_SLOT, start_minute: 9 * 60 + 15 }; // 09:15, 15 min out
    const { admin } = fakeDb({
      slots: [slot],
      coaches: [{ id: "coach-1", user_id: null }],
      athletes: [{ id: "athlete-1", first_name: "Greta" }],
    });
    const result = await computeLessonReminders({ admin }, now);
    expect(result).toEqual({ scanned: 1, wouldSend: 1, sent: 0 });
  });

  it("waits for the 15-minutes-out tick rather than firing 20 minutes early", async () => {
    const now = nowAtRinkTime(9, 0);
    const slot = { ...BASE_SLOT, start_minute: 9 * 60 + 20 };
    const { admin } = fakeDb({ slots: [slot] });
    const result = await computeLessonReminders({ admin }, now);
    expect(result).toEqual({ scanned: 0, wouldSend: 0, sent: 0 });
  });

  it("does not find an occurrence 30 minutes out (the old hour-before window is gone too)", async () => {
    const now = nowAtRinkTime(9, 0);
    const slot = { ...BASE_SLOT, start_minute: 9 * 60 + 30 };
    const { admin } = fakeDb({ slots: [slot] });
    const result = await computeLessonReminders({ admin }, now);
    expect(result).toEqual({ scanned: 0, wouldSend: 0, sent: 0 });
  });

  it("does not find an occurrence 5 minutes out", async () => {
    const now = nowAtRinkTime(9, 0);
    const slot = { ...BASE_SLOT, start_minute: 9 * 60 + 5 };
    const { admin } = fakeDb({ slots: [slot] });
    const result = await computeLessonReminders({ admin }, now);
    expect(result).toEqual({ scanned: 0, wouldSend: 0, sent: 0 });
  });

  it("does not double-upsert on a re-run within the same tick window", async () => {
    const now = nowAtRinkTime(9, 0);
    const slot = { ...BASE_SLOT, start_minute: 9 * 60 + 15 };
    const { admin, sent } = fakeDb({
      slots: [slot],
      coaches: [{ id: "coach-1", user_id: null }],
      athletes: [{ id: "athlete-1", first_name: "Greta" }],
    });

    const first = await computeLessonReminders({ admin }, now);
    expect(first).toEqual({ scanned: 1, wouldSend: 1, sent: 0 });
    expect(sent).toHaveLength(1);

    const second = await computeLessonReminders({ admin }, now);
    expect(second).toEqual({ scanned: 1, wouldSend: 0, sent: 0 });
    expect(sent).toHaveLength(1);
  });

  it("skips an occurrence canceled by an override", async () => {
    const now = nowAtRinkTime(9, 0);
    const slot = { ...BASE_SLOT, start_minute: 9 * 60 + 15 };
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
    expect(result).toEqual({ scanned: 0, wouldSend: 0, sent: 0 });
  });

  it("uses a rescheduled override's start_minute instead of the slot's own", async () => {
    const now = nowAtRinkTime(9, 0);
    // Slot's own time is 90 min out (would be skipped); the override moves
    // it to 15 min out.
    const slot = { ...BASE_SLOT, start_minute: 10 * 60 + 30 };
    const { dateIso } = nowInRinkTz(now);
    const { admin } = fakeDb({
      slots: [slot],
      overrides: [
        {
          slot_id: "slot-1",
          occurrence_date: dateIso,
          status: "rescheduled",
          start_minute: 9 * 60 + 15,
          end_minute: 10 * 60,
        },
      ],
      coaches: [{ id: "coach-1", user_id: null }],
      athletes: [{ id: "athlete-1", first_name: "Greta" }],
    });
    const result = await computeLessonReminders({ admin }, now);
    expect(result).toEqual({ scanned: 1, wouldSend: 1, sent: 0 });
  });

  it("still records the dedupe row when the coach has no device token", async () => {
    const now = nowAtRinkTime(9, 0);
    const slot = { ...BASE_SLOT, start_minute: 9 * 60 + 15 };
    const { admin, sent } = fakeDb({
      slots: [slot],
      coaches: [{ id: "coach-1", user_id: "coach-user-1" }],
      athletes: [{ id: "athlete-1", first_name: "Greta" }],
      deviceTokens: [],
    });
    const result = await computeLessonReminders({ admin }, now);
    expect(result).toEqual({ scanned: 1, wouldSend: 1, sent: 0 });
    expect(sent).toHaveLength(1);
  });

  it("resolves the coach's own user_id and routes to Roster", async () => {
    const logs: unknown[][] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args);
    try {
      const now = nowAtRinkTime(9, 0);
      const slot = { ...BASE_SLOT, start_minute: 9 * 60 + 15 };
      const { admin } = fakeDb({
        slots: [slot],
        coaches: [{ id: "coach-1", user_id: "coach-user-1" }],
        athletes: [{ id: "athlete-1", first_name: "Greta" }],
        deviceTokens: [{ user_id: "coach-user-1", token: "coach-tok", platform: "ios" }],
      });
      await computeLessonReminders({ admin }, now);
      const line = logs.find((l) => l[0] === "[api] lesson-reminders sending");
      expect(line).toBeDefined();
      const payload = JSON.parse(line![1] as string);
      expect(payload.coach.userId).toBe("coach-user-1");
      expect(payload.coach.tokenCount).toBe(1);
      expect(payload.coach.payload).toEqual({
        gradus: { type: "lesson_reminder", route: "coach/roster/briefing/athlete-1", v: 1 },
      });
      expect(payload.recipient).toBeUndefined();
    } finally {
      console.log = originalLog;
    }
  });

  it("pushes only the coach, naming the athlete who is up next", async () => {
    const now = nowAtRinkTime(9, 0);
    const { admin } = fakeDb({
      slots: [{ ...BASE_SLOT, start_minute: 9 * 60 + 15 }],
      coaches: [{ id: "coach-1", user_id: "coach-user-1" }],
      athletes: [{ id: "athlete-1", first_name: "Greta" }],
      deviceTokens: [
        { user_id: "coach-user-1", token: "coach-tok", platform: "ios" },
        { user_id: "athlete-user-1", token: "athlete-tok", platform: "ios" },
      ],
    });
    const sent: { token: string; route: unknown; alert: unknown; collapseId?: string }[] = [];
    const originalLog = console.log;
    console.log = () => {};
    try {
      const result = await computeLessonReminders(
        {
          admin,
          push: {
            config: {
              teamId: "T",
              keyId: "K",
              privateKeyPem: "unused",
              bundleId: "training.gradus.app",
              host: "https://apns.test",
            },
            send: async (_config, req) => {
              sent.push({
                token: req.token,
                route: (req.payload.gradus as { route: string }).route,
                alert: (req.payload.aps as { alert: unknown }).alert,
                collapseId: req.collapseId,
              });
              return { ok: true, apnsId: null };
            },
          },
        },
        now,
      );
      expect(result).toEqual({ scanned: 1, wouldSend: 1, sent: 1 });
    } finally {
      console.log = originalLog;
    }
    expect(sent).toEqual([
      {
        token: "coach-tok",
        route: "coach/roster/briefing/athlete-1",
        alert: {
          title: "Greta is up next",
          body: "See what they've been practicing since you last coached them.",
        },
        collapseId: "lesson:slot-1:" + nowInRinkTz(now).dateIso + ":coach",
      },
    ]);
  });

  it("ignores a biweekly slot on an off week even though it matches today's weekday", async () => {
    const now = nowAtRinkTime(9, 0);
    const { dateIso } = nowInRinkTz(now);
    // Anchor the slot's biweekly cycle one week *before* today, so today is
    // the "off" week (an un-paired cycle back) — this actually reaches the
    // `weeksBetween(anchor, cursor) % 2 === 0` parity check in
    // expandSlotOccurrences, unlike a future `starts_on`, which would short-
    // circuit via the "hasn't started yet" guard before the parity check
    // ever runs and pass for the wrong reason.
    const anchor = new Date(dateIso + "T12:00:00");
    anchor.setDate(anchor.getDate() - 7);
    const startsOn = anchor.toISOString().slice(0, 10);
    const slot = {
      ...BASE_SLOT,
      start_minute: 9 * 60 + 15,
      frequency: "biweekly",
      starts_on: startsOn,
    };
    const { admin } = fakeDb({ slots: [slot] });
    const result = await computeLessonReminders({ admin }, now);
    expect(result).toEqual({ scanned: 0, wouldSend: 0, sent: 0 });
  });

  it("finds a biweekly slot on an on week (two cycles back)", async () => {
    const now = nowAtRinkTime(9, 0);
    const { dateIso } = nowInRinkTz(now);
    // Anchor two weeks back — an on-week, so the parity check's `include`
    // branch should fire (the companion case to the off-week test above:
    // together they cover both sides of the biweekly parity check).
    const anchor = new Date(dateIso + "T12:00:00");
    anchor.setDate(anchor.getDate() - 14);
    const startsOn = anchor.toISOString().slice(0, 10);
    const slot = {
      ...BASE_SLOT,
      start_minute: 9 * 60 + 15,
      frequency: "biweekly",
      starts_on: startsOn,
    };
    const { admin } = fakeDb({
      slots: [slot],
      coaches: [{ id: "coach-1", user_id: null }],
      athletes: [{ id: "athlete-1", first_name: "Greta" }],
    });
    const result = await computeLessonReminders({ admin }, now);
    expect(result).toEqual({ scanned: 1, wouldSend: 1, sent: 0 });
  });

  it("skips a slot with no assigned coach", async () => {
    // coach_id is nulled out (not deleted) when a coach is unlinked from an
    // athlete's roster — see coach-roster.server.ts's removeAthleteFromRoster.
    // Nobody is up next for anyone then.
    const now = nowAtRinkTime(9, 0);
    const slot = { ...BASE_SLOT, coach_id: null, start_minute: 9 * 60 + 15 };
    const { admin, sent } = fakeDb({ slots: [slot] });
    const result = await computeLessonReminders({ admin }, now);
    expect(result).toEqual({ scanned: 0, wouldSend: 0, sent: 0 });
    expect(sent).toHaveLength(0);
  });

  it("finds an occurrence starting shortly after midnight, from the night before", async () => {
    // A slot starting 00:10 tomorrow (Wednesday) is 15 minutes out at
    // 23:55 tonight (Tuesday) — the day-boundary case: `nowInRinkTz`
    // reports Tuesday as today, so this occurrence only exists in the
    // "tomorrow" bucket, never in a same-day query on either side of
    // midnight.
    const now = nowAtRinkTime(23, 55);
    const { dayOfWeek } = nowInRinkTz(now);
    const slot = {
      ...BASE_SLOT,
      day_of_week: (dayOfWeek + 1) % 7,
      start_minute: 10,
    };
    const { admin } = fakeDb({
      slots: [slot],
      coaches: [{ id: "coach-1", user_id: null }],
      athletes: [{ id: "athlete-1", first_name: "Greta" }],
    });
    const result = await computeLessonReminders({ admin }, now);
    expect(result).toEqual({ scanned: 1, wouldSend: 1, sent: 0 });
  });

  it("dedupes a just-after-midnight occurrence against its own (tomorrow's) lesson_date", async () => {
    const now = nowAtRinkTime(23, 55);
    const { dayOfWeek, dateIso } = nowInRinkTz(now);
    const tomorrowIso = toIsoDate(addDays(parseIsoDate(dateIso), 1));
    const slot = {
      ...BASE_SLOT,
      day_of_week: (dayOfWeek + 1) % 7,
      start_minute: 10,
    };
    const { admin, sent } = fakeDb({
      slots: [slot],
      coaches: [{ id: "coach-1", user_id: null }],
      athletes: [{ id: "athlete-1", first_name: "Greta" }],
      // Already recorded for tomorrow's date — must be skipped, not
      // re-sent, and must NOT be mistaken for a dedupe row on tonight's date.
      alreadySent: [
        {
          slot_id: "slot-1",
          athlete_id: "athlete-1",
          coach_id: "coach-1",
          lesson_date: tomorrowIso,
          sent_at: null,
        },
      ],
    });
    const result = await computeLessonReminders({ admin }, now);
    expect(result).toEqual({ scanned: 1, wouldSend: 0, sent: 0 });
    expect(sent).toHaveLength(1);
  });

  it("does not treat a lesson well before midnight as a day-boundary candidate", async () => {
    // At 22:00pm, nothing tomorrow can be in the 10-15 minute window (the
    // earliest possible tomorrow start, 00:00, would be 120 minutes out) —
    // guards against the day-boundary bucket over-firing.
    const now = nowAtRinkTime(22, 0);
    const { dayOfWeek } = nowInRinkTz(now);
    const slot = {
      ...BASE_SLOT,
      day_of_week: (dayOfWeek + 1) % 7,
      start_minute: 0,
    };
    const { admin } = fakeDb({ slots: [slot] });
    const result = await computeLessonReminders({ admin }, now);
    expect(result).toEqual({ scanned: 0, wouldSend: 0, sent: 0 });
  });
});

describe("nowInRinkTz", () => {
  it("returns a day-of-week consistent with the calendar date it reports", () => {
    const { dateIso, dayOfWeek } = nowInRinkTz(new Date());
    const [y, m, d] = dateIso.split("-").map(Number);
    expect(new Date(y!, m! - 1, d!).getDay()).toBe(dayOfWeek);
  });
});
