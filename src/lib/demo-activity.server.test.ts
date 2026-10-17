import { describe, expect, it } from "bun:test";
import { runDemoActivityRefresh } from "./demo-activity.server";
import {
  DEMO_ACCOUNT_DEFAULTS,
  DEMO_MESSAGES,
  DEMO_SESSIONS,
  demoTimestamp,
} from "./demo-activity";

type Row = Record<string, unknown>;
type Write = { table: string; op: "update" | "insert"; rows: Row[] };

/**
 * A minimal fake covering exactly the calls `runDemoActivityRefresh` makes:
 * `auth.admin.listUsers`, `.select()` chained with `.eq()`/`.in()`/
 * `.order()`/`.limit()` and ending in `.maybeSingle()`, `.single()` or an
 * await, `.update().eq()`, and `.insert()` (awaited, or `.select().single()`).
 * Every write is recorded so a test can check what was touched.
 */
function fakeDb(seed: { users?: { id: string; email: string }[]; tables?: Record<string, Row[]> }) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seed.tables ?? {})) {
    tables[name] = rows.map((r) => ({ ...r }));
  }
  const rowsOf = (name: string) => (tables[name] ??= []);
  const writes: Write[] = [];
  let nextId = 1;

  const makeQuery = (rows: Row[]) => {
    const self = {
      eq: (col: string, val: unknown) => makeQuery(rows.filter((r) => r[col] === val)),
      in: (col: string, vals: unknown[]) => makeQuery(rows.filter((r) => vals.includes(r[col]))),
      order: (col: string, opts: { ascending: boolean }) =>
        makeQuery(
          [...rows].sort((a, b) => {
            const cmp = String(a[col]).localeCompare(String(b[col]));
            return opts.ascending ? cmp : -cmp;
          }),
        ),
      limit: (n: number) => makeQuery(rows.slice(0, n)),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      single: () =>
        Promise.resolve(
          rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: "no rows" } },
        ),
      then: (resolve: (v: { data: Row[]; error: null }) => void) =>
        resolve({ data: rows, error: null }),
    };
    return self;
  };

  const from = (name: string) => ({
    select: (_cols: string) => makeQuery(rowsOf(name)),
    update: (fields: Row) => ({
      eq: (col: string, val: unknown) => {
        const hit = rowsOf(name).filter((r) => r[col] === val);
        for (const r of hit) Object.assign(r, fields);
        writes.push({ table: name, op: "update", rows: hit.map((r) => ({ ...r })) });
        return Promise.resolve({ error: null });
      },
    }),
    insert: (payload: Row | Row[]) => {
      const added = (Array.isArray(payload) ? payload : [payload]).map((r) => ({
        id: `${name}-new-${nextId++}`,
        ...r,
      }));
      rowsOf(name).push(...added);
      writes.push({ table: name, op: "insert", rows: added });
      return {
        select: (_cols: string) => ({
          single: () => Promise.resolve({ data: added[0], error: null }),
        }),
        then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
      };
    },
  });

  const admin = {
    from,
    auth: {
      admin: {
        listUsers: ({ page }: { page: number; perPage: number }) =>
          Promise.resolve({
            data: { users: page === 1 ? (seed.users ?? []) : [] },
            error: null,
          }),
      },
    },
  };
  return { admin, tables, writes };
}

const NOW = new Date("2026-10-17T08:17:00Z");
const OLD = "2026-09-20T22:00:00.000Z";

/** The default demo set, seeded a month ago with half its activity. */
function demoSeed(overrides: { coach?: Row; athlete?: Row; parent?: Row } = {}) {
  return {
    users: [
      { id: "u-coach", email: DEMO_ACCOUNT_DEFAULTS.coachEmail },
      { id: "u-parent", email: DEMO_ACCOUNT_DEFAULTS.parentEmail },
      { id: "u-athlete", email: "athlete-a1@users.gradus.invalid" },
      { id: "u-real", email: "real-coach@example.com" },
    ],
    tables: {
      coach_profiles: [
        { id: "c1", user_id: "u-coach", is_test: true, ...overrides.coach },
        { id: "c-real", user_id: "u-real", is_test: false },
      ],
      athletes: [
        {
          id: "a1",
          user_id: "u-athlete",
          parent_id: "p1",
          username: DEMO_ACCOUNT_DEFAULTS.athleteUsername,
          is_test: true,
          ...overrides.athlete,
        },
        { id: "a-real", user_id: "u-real-athlete", parent_id: null, username: "real_kid" },
      ],
      parent_profiles: [{ id: "p1", user_id: "u-parent", is_test: true, ...overrides.parent }],
      plans: [
        {
          id: "plan-old",
          coach_id: "c1",
          athlete_id: "a1",
          kind: "plan",
          status: "archived",
          updated_at: "2026-09-01",
        },
        {
          id: "plan-1",
          coach_id: "c1",
          athlete_id: "a1",
          kind: "plan",
          status: "active",
          updated_at: "2026-09-16",
        },
        {
          id: "plan-real",
          coach_id: "c-real",
          athlete_id: "a-real",
          kind: "plan",
          status: "active",
          updated_at: "2026-10-01",
        },
      ],
      message_rooms: [
        { id: "room-1", coach_id: "c1", athlete_id: "a1" },
        { id: "room-real", coach_id: "c-real", athlete_id: "a-real" },
      ],
      plan_sessions: [
        ...DEMO_SESSIONS.slice(0, 3).map((s, i) => ({
          id: `s-${i}`,
          plan_id: "plan-1",
          athlete_id: "a1",
          note: s.note,
          logged_at: OLD,
        })),
        // A real athlete who happens to write the same note: never touched.
        {
          id: "s-real",
          plan_id: "plan-real",
          athlete_id: "a-real",
          note: DEMO_SESSIONS[0].note,
          logged_at: OLD,
        },
      ],
      messages: [
        ...DEMO_MESSAGES.slice(0, 2).map((m, i) => ({
          id: `m-${i}`,
          room_id: "room-1",
          body: m.body,
          sender_role: m.sender,
          created_at: OLD,
        })),
        {
          id: "m-real",
          room_id: "room-real",
          body: DEMO_MESSAGES[0].body,
          sender_role: "coach",
          created_at: OLD,
        },
      ],
    },
  };
}

describe("runDemoActivityRefresh", () => {
  it("re-dates the demo athlete's sessions and messages and adds the missing ones", async () => {
    const { admin, tables } = fakeDb(demoSeed());
    const result = await runDemoActivityRefresh({ admin }, NOW);
    expect(result).toEqual({
      refreshed: true,
      sessions: DEMO_SESSIONS.length,
      messages: DEMO_MESSAGES.length,
    });

    const sessions = tables.plan_sessions.filter((r) => r.plan_id === "plan-1");
    expect(sessions).toHaveLength(DEMO_SESSIONS.length);
    for (const s of DEMO_SESSIONS) {
      const row = sessions.find((r) => r.note === s.note);
      expect(row?.logged_at).toBe(demoTimestamp(NOW, s.daysAgo, s.hourUtc));
      expect(row?.athlete_id).toBe("a1");
    }
    // Existing rows moved in place, not replaced.
    expect(sessions.filter((r) => String(r.id).startsWith("s-"))).toHaveLength(3);

    const messages = tables.messages.filter((r) => r.room_id === "room-1");
    expect(messages).toHaveLength(DEMO_MESSAGES.length);
    const senderIds = { coach: "u-coach", parent: "u-parent", athlete: "u-athlete" };
    for (const m of DEMO_MESSAGES) {
      const row = messages.find((r) => r.body === m.body);
      expect(row?.created_at).toBe(demoTimestamp(NOW, m.daysAgo, m.hourUtc, m.minute));
      // Only the inserted rows carry a sender here; the seeded two keep theirs.
      if (!String(row?.id).startsWith("m-")) expect(row?.sender_user_id).toBe(senderIds[m.sender]);
    }
  });

  it("never touches another coach's rows, even with the same text", async () => {
    const { admin, tables, writes } = fakeDb(demoSeed());
    await runDemoActivityRefresh({ admin }, NOW);

    expect(tables.plan_sessions.find((r) => r.id === "s-real")?.logged_at).toBe(OLD);
    expect(tables.messages.find((r) => r.id === "m-real")?.created_at).toBe(OLD);
    for (const w of writes) {
      for (const r of w.rows) {
        if (w.table === "plan_sessions") expect(r.plan_id).toBe("plan-1");
        if (w.table === "messages") expect(r.room_id).toBe("room-1");
      }
    }
    expect(writes.some((w) => w.table !== "plan_sessions" && w.table !== "messages")).toBe(false);
  });

  it("adds no duplicates when it runs again the next day", async () => {
    const { admin, tables, writes } = fakeDb(demoSeed());
    await runDemoActivityRefresh({ admin }, NOW);
    const firstInserts = writes.filter((w) => w.op === "insert").length;

    const tomorrow = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    await runDemoActivityRefresh({ admin }, tomorrow);
    expect(writes.filter((w) => w.op === "insert")).toHaveLength(firstInserts);
    expect(tables.plan_sessions.filter((r) => r.plan_id === "plan-1")).toHaveLength(
      DEMO_SESSIONS.length,
    );
    expect(tables.messages.filter((r) => r.room_id === "room-1")).toHaveLength(
      DEMO_MESSAGES.length,
    );
    const newest = tables.plan_sessions.find(
      (r) => r.note === DEMO_SESSIONS[0].note && r.plan_id === "plan-1",
    );
    expect(newest?.logged_at).toBe(
      demoTimestamp(tomorrow, DEMO_SESSIONS[0].daysAgo, DEMO_SESSIONS[0].hourUtc),
    );
  });

  it("opens the coach–athlete room when there isn't one", async () => {
    const seed = demoSeed();
    seed.tables.message_rooms = seed.tables.message_rooms.filter((r) => r.id !== "room-1");
    seed.tables.messages = seed.tables.messages.filter((r) => r.room_id !== "room-1");
    const { admin, tables } = fakeDb(seed);
    await runDemoActivityRefresh({ admin }, NOW);

    const room = tables.message_rooms.find((r) => r.coach_id === "c1" && r.athlete_id === "a1");
    expect(room).toBeDefined();
    expect(tables.messages.filter((r) => r.room_id === room?.id)).toHaveLength(
      DEMO_MESSAGES.length,
    );
  });

  it("does nothing when the demo accounts haven't been created", async () => {
    const { admin, writes } = fakeDb({
      users: [{ id: "u-real", email: "real-coach@example.com" }],
      tables: { coach_profiles: [{ id: "c-real", user_id: "u-real", is_test: false }] },
    });
    const result = await runDemoActivityRefresh({ admin }, NOW);
    expect(result).toEqual({ refreshed: false, reason: "Create the demo accounts first" });
    expect(writes).toHaveLength(0);
  });

  it("does nothing when only the demo coach exists", async () => {
    const seed = demoSeed();
    seed.tables.athletes = seed.tables.athletes.filter((r) => r.id !== "a1");
    const { admin, writes } = fakeDb(seed);
    const result = await runDemoActivityRefresh({ admin }, NOW);
    expect(result.refreshed).toBe(false);
    expect(writes).toHaveLength(0);
  });

  const notTest: [string, Parameters<typeof demoSeed>[0]][] = [
    ["coach", { coach: { is_test: false } }],
    ["athlete", { athlete: { is_test: false } }],
    ["athlete's parent", { parent: { is_test: false } }],
  ];
  for (const [who, overrides] of notTest) {
    it(`refuses when the ${who} isn't a test row`, async () => {
      const { admin, writes } = fakeDb(demoSeed(overrides));
      await expect(runDemoActivityRefresh({ admin }, NOW)).rejects.toThrow(
        "These aren't demo accounts",
      );
      expect(writes).toHaveLength(0);
    });
  }

  it("fails loudly when the demo athlete has no active plan", async () => {
    const seed = demoSeed();
    seed.tables.plans = seed.tables.plans.filter((r) => r.id !== "plan-1");
    const { admin, writes } = fakeDb(seed);
    await expect(runDemoActivityRefresh({ admin }, NOW)).rejects.toThrow("no active plan");
    expect(writes).toHaveLength(0);
  });
});
