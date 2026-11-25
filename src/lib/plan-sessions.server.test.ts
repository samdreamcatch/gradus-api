import { describe, expect, it } from "bun:test";
import { IN_CHUNK } from "./db-batch";
import {
  getPlanSessionCounts,
  listPlanSessions,
  loadSessionsByPlanIds,
  type SessionsContext,
} from "./plan-sessions.server";

/**
 * A chainable fake client: every query on `table` resolves to `rows[table]`.
 * `maybeSingle` resolves to the first row.
 */
function fakeClient(rows: Record<string, unknown[]>) {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "lt", "order", "limit"]) self[m] = () => self;
    self.maybeSingle = () => Promise.resolve({ data: rows[table]?.[0] ?? null, error: null });
    self.then = (resolve: (v: unknown) => void) =>
      resolve({ data: rows[table] ?? [], error: null });
    return self;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => chain(table) } as any;
}

describe("listPlanSessions", () => {
  it("gives the parent or athlete each move's rating in plan order", async () => {
    const supabase = fakeClient({
      plans: [{ id: "plan-1", athlete_id: "ath-1", athletes: { first_name: "Wren" } }],
      plan_sessions: [
        {
          id: "s-2",
          logged_at: "2026-10-15T17:00:00Z",
          duration_seconds: 1200,
          state_index: 2,
          note: "Loop felt shaky.",
          parent_id: "par-1",
          feedback_scope: "moves",
          plan_session_move_ratings: [
            { plan_move_id: "pm-2", move_name: "Loop jump", position: 1, state_index: 1 },
            { plan_move_id: "pm-1", move_name: "Waltz jump", position: 0, state_index: 4 },
          ],
        },
        {
          id: "s-1",
          logged_at: "2026-10-14T17:00:00Z",
          duration_seconds: 900,
          state_index: 3,
          note: "",
          parent_id: null,
          feedback_scope: "plan",
          plan_session_move_ratings: [],
        },
      ],
    });
    const admin = fakeClient({ parent_profiles: [{ id: "par-1", first_name: "Odette" }] });
    const ctx: SessionsContext = { userId: "par-user", supabase, admin };

    const log = await listPlanSessions(ctx, "plan-1");

    expect(log.sessions[0]).toMatchObject({
      feedbackScope: "moves",
      loggedByFirstName: "Odette",
      moveRatings: [
        { planMoveId: "pm-1", moveName: "Waltz jump", stateIndex: 4 },
        { planMoveId: "pm-2", moveName: "Loop jump", stateIndex: 1 },
      ],
    });
    expect(log.sessions[1]?.feedbackScope).toBe("plan");
    expect(log.sessions[1]?.moveRatings).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* loadSessionsByPlanIds                                                      */
/* -------------------------------------------------------------------------- */

type Row = Record<string, unknown>;
type DbError = { code: string; message: string };

/**
 * `plans` and `plan_sessions` answered from rows, filtered by `.in()`, paged by
 * `.range()`. Each request stays open for a tick, as one over the network
 * does, so requests sent together are counted together. `errors[table]` fails
 * that table's reads; `"throw"` rejects the call instead.
 */
function countingClient(
  tables: { plans?: Row[]; plan_sessions?: Row[] },
  errors: Partial<Record<"plans" | "plan_sessions", DbError | "throw">> = {},
) {
  const sent: string[] = [];
  const load = { open: 0, peak: 0 };
  const from = (table: "plans" | "plan_sessions") => {
    let wanted: unknown[] | null = null;
    let column = "";
    let range: [number, number] | null = null;
    const run = async () => {
      sent.push(table);
      load.open += 1;
      load.peak = Math.max(load.peak, load.open);
      try {
        await Promise.resolve();
        const failure = errors[table];
        if (failure === "throw") throw new TypeError("fetch failed");
        if (failure) return { data: null, error: failure, count: null };
        const all = (tables[table] ?? []).filter((r) => !wanted || wanted.includes(r[column]));
        const page = range ? all.slice(range[0], range[1] + 1) : all;
        return { data: page, error: null, count: all.length };
      } finally {
        load.open -= 1;
      }
    };
    const self = {
      select: () => self,
      order: () => self,
      in(col: string, values: unknown[]) {
        column = col;
        wanted = values;
        return self;
      },
      range(a: number, b: number) {
        range = [a, b];
        return self;
      },
      then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
        run().then(resolve, reject);
      },
    };
    return self;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from } as any, sent, load };
}

async function thrown(run: () => Promise<unknown>): Promise<unknown> {
  const real = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    await run();
    return { error: null, logged };
  } catch (error) {
    return { error, logged };
  } finally {
    console.error = real;
  }
}

const session = (plan: string, athlete: string, state: number): Row => ({
  plan_id: plan,
  athlete_id: athlete,
  state_index: state,
});

describe("loadSessionsByPlanIds", () => {
  const tables = () => ({
    plans: [
      { id: "plan-1", athlete_id: "ath-1" },
      { id: "plan-2", athlete_id: "ath-2" },
      { id: "plan-3", athlete_id: null },
      { id: "not-asked-for", athlete_id: "ath-1" },
    ],
    plan_sessions: [
      session("plan-1", "ath-1", 0),
      session("plan-1", "ath-1", 4),
      session("plan-1", "ath-1", 4),
      // Left over from the athlete the plan used to belong to: not counted.
      session("plan-1", "ath-9", 2),
      session("plan-2", "ath-2", 3),
      // A state the bars do not have: not counted.
      session("plan-2", "ath-2", 7),
      // A plan with no athlete counts none of its sessions.
      session("plan-3", "ath-1", 1),
      session("not-asked-for", "ath-1", 1),
    ],
  });

  it("counts each plan's sessions by state, for the plan's current athlete only", async () => {
    const db = countingClient(tables());
    const counts = await loadSessionsByPlanIds(db.client, ["plan-1", "plan-2", "plan-3", "gone"]);

    expect(Object.fromEntries(counts)).toEqual({
      "plan-1": {
        sessionsByState: { frustrated: 1, pushing: 0, steady: 0, lockedIn: 0, flowing: 2 },
        sessionsTotal: 3,
      },
      "plan-2": {
        sessionsByState: { frustrated: 0, pushing: 0, steady: 0, lockedIn: 1, flowing: 0 },
        sessionsTotal: 1,
      },
      "plan-3": {
        sessionsByState: { frustrated: 0, pushing: 0, steady: 0, lockedIn: 0, flowing: 0 },
        sessionsTotal: 0,
      },
      // An id with no plan row still has an entry, at zero.
      gone: {
        sessionsByState: { frustrated: 0, pushing: 0, steady: 0, lockedIn: 0, flowing: 0 },
        sessionsTotal: 0,
      },
    });
  });

  it("sends the two reads together: two requests, both open at once", async () => {
    const db = countingClient(tables());
    await loadSessionsByPlanIds(db.client, ["plan-1", "plan-2"]);
    // Sent together, so which leaves first does not matter.
    expect([...db.sent].sort()).toEqual(["plan_sessions", "plans"]);
    expect(db.load.peak).toBe(2);
  });

  it("makes no request for an empty list", async () => {
    const db = countingClient(tables());
    expect((await loadSessionsByPlanIds(db.client, [])).size).toBe(0);
    expect(db.sent).toEqual([]);
  });

  it("getPlanSessionCounts is the same two requests for one plan", async () => {
    const db = countingClient(tables());
    expect(await getPlanSessionCounts(db.client, "plan-2")).toEqual({
      sessionsByState: { frustrated: 0, pushing: 0, steady: 0, lockedIn: 1, flowing: 0 },
      sessionsTotal: 1,
    });
    expect([...db.sent].sort()).toEqual(["plan_sessions", "plans"]);
    expect(db.load.peak).toBe(2);
  });

  it("reads every page of sessions, and a second hundred plans after the first", async () => {
    const ids = Array.from({ length: IN_CHUNK + 1 }, (_, i) => `plan-${i}`);
    const many = {
      plans: ids.map((id) => ({ id, athlete_id: "ath-1" })),
      // 1,200 sessions on the first plan: two pages of the first chunk.
      plan_sessions: [
        ...Array.from({ length: 1200 }, () => session("plan-0", "ath-1", 2)),
        session(`plan-${IN_CHUNK}`, "ath-1", 2),
      ],
    };
    const db = countingClient(many);
    const counts = await loadSessionsByPlanIds(db.client, ids);

    expect(counts.get("plan-0")?.sessionsTotal).toBe(1200);
    expect(counts.get(`plan-${IN_CHUNK}`)?.sessionsTotal).toBe(1);
    // First chunk: plans beside page one, then page two. Second chunk: the pair again.
    // Never more than two open: chunks run one after another.
    expect([...db.sent.slice(0, 3)].sort()).toEqual(["plan_sessions", "plan_sessions", "plans"]);
    expect([...db.sent.slice(3)].sort()).toEqual(["plan_sessions", "plans"]);
    expect(db.load.peak).toBe(2);
  });

  describe("which failure answers", () => {
    const plansDown: DbError = { code: "57014", message: "plans read timed out" };
    const sessionsDown: DbError = { code: "57014", message: "plan_sessions read timed out" };
    type Outcome = { error: Error & { dbDetail?: { message: string } }; logged: unknown[][] };
    const run = (errors: Parameters<typeof countingClient>[1]) =>
      thrown(() =>
        loadSessionsByPlanIds(countingClient(tables(), errors).client, ["plan-1"]),
      ) as Promise<Outcome>;

    it("a failed plans read", async () => {
      const { error } = await run({ plans: plansDown });
      expect(error.message).toBe("Something went wrong. Please try again.");
      expect(error.dbDetail?.message).toBe("plans read timed out");
    });

    it("a failed sessions read", async () => {
      const { error } = await run({ plan_sessions: sessionsDown });
      expect(error.message).toBe("Something went wrong. Please try again.");
      expect(error.dbDetail?.message).toBe("plan_sessions read timed out");
    });

    it("the plans read's, when both fail, as when it ran first, logged once", async () => {
      const { error, logged } = await run({ plans: plansDown, plan_sessions: sessionsDown });
      expect(error.dbDetail?.message).toBe("plans read timed out");
      // Only the error that answers is logged, as when the sessions read never ran.
      expect(logged).toEqual([["[db]", plansDown]]);
    });

    it("a failed sessions read is logged once, as before", async () => {
      const { logged } = await run({ plan_sessions: sessionsDown });
      expect(logged).toEqual([["[db]", sessionsDown]]);
    });

    it("a failed plans read stops the sessions paging: no page after the first", async () => {
      const many = tables();
      many.plan_sessions = Array.from({ length: 3000 }, () => session("plan-1", "ath-1", 2));
      const db = countingClient(many, { plans: plansDown });
      const { error } = (await thrown(() =>
        loadSessionsByPlanIds(db.client, ["plan-1"]),
      )) as Outcome;
      expect(error.dbDetail?.message).toBe("plans read timed out");
      // The first page was already on its way beside the plans read; no second one.
      expect(db.sent).toHaveLength(2);
      expect([...db.sent].sort()).toEqual(["plan_sessions", "plans"]);
    });

    it("a rejected plans call, with nothing left unhandled from the sessions read", async () => {
      const { error } = await run({ plans: "throw", plan_sessions: sessionsDown });
      expect(error).toBeInstanceOf(TypeError);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    it("the plans read's error, over a rejected sessions call", async () => {
      const { error } = await run({ plans: plansDown, plan_sessions: "throw" });
      expect(error.dbDetail?.message).toBe("plans read timed out");
    });

    it("a rejected sessions call, when the plans read is fine", async () => {
      const { error } = await run({ plan_sessions: "throw" });
      expect(error).toBeInstanceOf(TypeError);
    });
  });
});
