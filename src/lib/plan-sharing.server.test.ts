import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import {
  cascadeStatusToCopies,
  deleteDraftCopies,
  loadCopyIdsByPlan,
  loadShareInfo,
  loadUpdatedMoves,
  sharePlanFor,
  updateCopiesFor,
  type ShareAnnouncers,
} from "./plan-sharing.server";
import { applyDraft } from "./voice.server";
import {
  deletePlan,
  getPlan,
  listPlans,
  savePlan,
  setPlanStatus,
  updatePlan,
  type CoachReasonInput,
} from "./plans.server";

/**
 * A small in-memory database behind the query builder these modules use, so
 * the tests check what ends up stored, not which calls were made. Columns are
 * not projected (a select returns whole rows); filters, order, range, limit,
 * insert, update, upsert, and delete behave as PostgREST's do, including the
 * limits that bite at squad size: an optional row cap on selects, upserts
 * that write a missing column as NULL, and the one-copy-per-athlete index.
 * Deleting a plan drops its moves and clears `shared_from_id` on its copies,
 * as the schema does.
 */
type Row = Record<string, unknown>;
type FakeOptions = {
  /** PostgREST's row cap: a select answers with at most this many rows, silently. */
  maxRows?: number;
  /** Fails the nth request to `table.op` (1-based), once. */
  failOn?: { request: string; nth: number };
};
function memoryDb(seed: Record<string, Row[]>, options: FakeOptions = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  let nextId = 1;
  const requests: string[] = [];
  /** The longest `in (...)` list any request carried: what would travel in the URL. */
  const stats = { longestIn: 0 };
  const table = (name: string) => (tables[name] ??= []);
  const cmp = (a: unknown, b: unknown) =>
    typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));

  const builder = (name: string) => {
    let op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
    let payload: Row | Row[] | undefined;
    let returning = false;
    let counted = false;
    const orderBy: { column: string; ascending: boolean }[] = [];
    let max: number | null = null;
    let window: [number, number] | null = null;
    const tests: Array<(r: Row) => boolean> = [];

    const run = (): { rows: Row[]; count: number | null; error: { code: string } | null } => {
      const label = `${name}.${op}`;
      requests.push(label);
      if (
        options.failOn?.request === label &&
        requests.filter((r) => r === label).length === options.failOn.nth
      ) {
        return { rows: [], count: null, error: { code: "XX000" } };
      }
      const rows = table(name);
      const hit = (r: Row) => tests.every((t) => t(r));
      let out: Row[] = [];
      if (op === "select") {
        out = rows.filter(hit);
      } else if (op === "insert") {
        const list = Array.isArray(payload) ? payload : [payload as Row];
        if (name === "plans") {
          // `plans_one_copy_per_athlete`: the whole statement is refused.
          const taken = (r: Row, among: Row[]) =>
            !!r.shared_from_id &&
            !!r.athlete_id &&
            among.some(
              (x) => x.shared_from_id === r.shared_from_id && x.athlete_id === r.athlete_id,
            );
          if (list.some((r, i) => taken(r, rows) || taken(r, list.slice(0, i)))) {
            return { rows: [], count: null, error: { code: "23505" } };
          }
        }
        out = list.map((r) => {
          const row = { id: `${name}-${nextId++}`, created_at: "2026-11-01T00:00:00Z", ...r };
          rows.push(row);
          return row;
        });
      } else if (op === "upsert") {
        // As PostgREST does it: every row is written with the union of the
        // rows' columns, and a column a row leaves out is written as NULL.
        const columns = new Set((payload as Row[]).flatMap((r) => Object.keys(r)));
        for (const r of payload as Row[]) {
          const full: Row = {};
          for (const c of columns) full[c] = c in r ? r[c] : null;
          const existing = rows.find((x) => x.id === r.id);
          if (existing) Object.assign(existing, full);
          else rows.push({ ...full });
          out.push(existing ?? full);
        }
      } else if (op === "update") {
        out = rows.filter(hit);
        for (const r of out) Object.assign(r, payload as Row);
      } else {
        out = rows.filter(hit);
        tables[name] = rows.filter((r) => !out.includes(r));
        if (name === "plans") {
          const gone = new Set(out.map((r) => r.id));
          tables.plan_moves = table("plan_moves").filter((m) => !gone.has(m.plan_id));
          for (const p of table("plans")) if (gone.has(p.shared_from_id)) p.shared_from_id = null;
        }
      }
      for (const { column, ascending } of [...orderBy].reverse()) {
        out = [...out].sort((a, b) => cmp(a[column], b[column]) * (ascending ? 1 : -1));
      }
      const count = counted ? out.length : null;
      if (window) out = out.slice(window[0], window[1] + 1);
      if (max !== null) out = out.slice(0, max);
      if (op === "select" && options.maxRows !== undefined) out = out.slice(0, options.maxRows);
      return { rows: out.map((r) => ({ ...r })), count, error: null };
    };

    const self: Record<string, unknown> = {
      select: (_columns?: string, opts?: { count?: string }) => {
        if (op !== "select") returning = true;
        if (opts?.count) counted = true;
        return self;
      },
      insert: (p: Row | Row[]) => ((op = "insert"), (payload = p), self),
      update: (p: Row) => ((op = "update"), (payload = p), self),
      upsert: (p: Row[]) => ((op = "upsert"), (payload = p), self),
      delete: () => ((op = "delete"), self),
      eq: (c: string, v: unknown) => (tests.push((r) => r[c] === v), self),
      neq: (c: string, v: unknown) => (tests.push((r) => r[c] !== v), self),
      is: (c: string, v: unknown) => (tests.push((r) => (r[c] ?? null) === v), self),
      in: (c: string, v: unknown[]) => {
        stats.longestIn = Math.max(stats.longestIn, v.length);
        tests.push((r) => v.includes(r[c]));
        return self;
      },
      gt: (c: string, v: string) => (tests.push((r) => String(r[c]) > v), self),
      order: (column: string, o: { ascending: boolean }) => (
        orderBy.push({ column, ascending: o.ascending }),
        self
      ),
      range: (from: number, to: number) => ((window = [from, to]), self),
      limit: (n: number) => ((max = n), self),
      maybeSingle: async () => {
        const res = run();
        return { data: res.rows[0] ?? null, error: res.error };
      },
      single: async () => {
        const res = run();
        return { data: res.rows[0] ?? null, error: res.error };
      },
      then: (resolve: (v: unknown) => void) => {
        const res = run();
        resolve({
          data: res.error ? null : op === "select" || returning ? res.rows : null,
          error: res.error,
          count: res.count,
        });
      },
    };
    return self;
  };
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: { from: (name: string) => builder(name) } as any,
    tables,
    table,
    requests,
    stats,
  };
}

const COACH = "coach-1";
const [GRETA, TOBIAS, ELSIE, MAEVE] = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
];
const NAMES: Record<string, [string, string]> = {
  [GRETA]: ["Greta", "Halvorsen"],
  [TOBIAS]: ["Tobias", "Fairbank"],
  [ELSIE]: ["Elsie", "Varga"],
  [MAEVE]: ["Maeve", "Abbott"],
};

const planRow = (over: Row): Row => ({
  coach_id: COACH,
  title: "Off-ice warm-up",
  notes: "",
  kind: "plan",
  status: "draft",
  athlete_id: null,
  feedback_scope: "plan",
  shared_from_id: null,
  shared_synced: null,
  shared_changes: null,
  updated_at: "2026-11-01T00:00:00Z",
  ...over,
});
const moveRow = (planId: string, position: number, name: string, over: Row = {}): Row => ({
  id: `${planId}-m${position}`,
  plan_id: planId,
  position,
  move_id: null,
  name,
  description: "",
  cue: "",
  why: "",
  target_kind: "mins",
  target_value: 3,
  ...over,
});

/** A coach with four athletes and one plan ("Off-ice warm-up": two moves). */
function squad(
  plan: Row = {},
  roster = [GRETA, TOBIAS, ELSIE, MAEVE],
  options: FakeOptions = {},
) {
  return memoryDb(
    {
    coach_profiles: [{ id: COACH, user_id: "user-1" }],
    coach_athletes: roster.map((athlete_id) => ({ coach_id: COACH, athlete_id })),
    athletes: Object.entries(NAMES).map(([id, [first_name, last_name]]) => ({
      id,
      first_name,
      last_name,
    })),
    plans: [planRow({ id: "plan-1", ...plan })],
    plan_moves: [moveRow("plan-1", 0, "Jump rope"), moveRow("plan-1", 1, "Arm circles")],
    plan_sessions: [],
    },
    options,
  );
}

function spies() {
  const activated: Array<{ athleteId: string; planId: string }> = [];
  const updated: Array<{ athleteId: string; planId: string }> = [];
  const announce: ShareAnnouncers = {
    activated: async (_coach, plans) => void activated.push(...plans),
    updated: async (plans) => void updated.push(...plans),
  };
  return { activated, updated, announce };
}

const NOW = new Date("2026-11-10T12:00:00Z");
const copiesOf = (db: ReturnType<typeof memoryDb>, id: string) =>
  db.table("plans").filter((p) => p.shared_from_id === id);
const movesOf = (db: ReturnType<typeof memoryDb>, id: string) =>
  db
    .table("plan_moves")
    .filter((m) => m.plan_id === id)
    .sort((a, b) => Number(a.position) - Number(b.position));
const copyFor = (db: ReturnType<typeof memoryDb>, id: string, athlete: string) =>
  copiesOf(db, id).find((p) => p.athlete_id === athlete) as Row;

async function caught(run: () => Promise<unknown>): Promise<ApiError | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof ApiError ? err : null;
  }
}

describe("giving a plan to several athletes", () => {
  it("gives each athlete a live copy and keeps the plan as the one the coach edits", async () => {
    const db = squad();
    const s = spies();
    const result = await sharePlanFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA, TOBIAS, ELSIE], activate: true },
      NOW,
      s.announce,
    );

    expect(result).toEqual({ id: "plan-1", shared: 3 });
    const source = db.table("plans").find((p) => p.id === "plan-1") as Row;
    expect(source.status).toBe("active");
    expect(source.athlete_id).toBeNull();
    expect(source.shared_synced).not.toBeNull();

    const copies = copiesOf(db, "plan-1");
    expect(copies.map((c) => c.athlete_id).sort()).toEqual([GRETA, TOBIAS, ELSIE].sort());
    for (const copy of copies) {
      expect(copy.status).toBe("active");
      expect(copy.title).toBe("Off-ice warm-up");
      expect(movesOf(db, copy.id as string).map((m) => m.name)).toEqual([
        "Jump rope",
        "Arm circles",
      ]);
    }
    expect(s.activated.map((a) => a.athleteId).sort()).toEqual([GRETA, TOBIAS, ELSIE].sort());
  });

  it("uses the same handful of requests for three athletes as for one", async () => {
    const one = squad();
    await sharePlanFor(
      one.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA], activate: true },
      NOW,
      spies().announce,
    );
    const three = squad();
    await sharePlanFor(
      three.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA, TOBIAS, ELSIE], activate: true },
      NOW,
      spies().announce,
    );
    expect(three.requests.length).toBe(one.requests.length);
  });

  it("saves drafts and tells nobody when the coach wants to adjust first", async () => {
    const db = squad();
    const s = spies();
    await sharePlanFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA, MAEVE], activate: false },
      NOW,
      s.announce,
    );
    expect(copiesOf(db, "plan-1").map((c) => c.status)).toEqual(["draft", "draft"]);
    expect((db.table("plans").find((p) => p.id === "plan-1") as Row).status).toBe("draft");
    expect(s.activated).toEqual([]);
  });

  it("refuses the whole request when one athlete is not on the roster", async () => {
    const db = squad({}, [GRETA, TOBIAS]);
    const err = await caught(() =>
      sharePlanFor(
        db.client,
        COACH,
        "plan-1",
        { athleteIds: [GRETA, ELSIE], activate: true },
        NOW,
        spies().announce,
      ),
    );
    expect(err?.status).toBe(403);
    expect(copiesOf(db, "plan-1")).toEqual([]);
  });

  it("answers not found for another coach's plan", async () => {
    const db = squad({ coach_id: "coach-2" });
    const err = await caught(() =>
      sharePlanFor(
        db.client,
        COACH,
        "plan-1",
        { athleteIds: [GRETA], activate: true },
        NOW,
        spies().announce,
      ),
    );
    expect(err?.status).toBe(404);
  });

  it("turns a draft for one athlete into the plan for all of them", async () => {
    const db = squad({ athlete_id: GRETA });
    await sharePlanFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA, TOBIAS], activate: false },
      NOW,
      spies().announce,
    );
    expect((db.table("plans").find((p) => p.id === "plan-1") as Row).athlete_id).toBeNull();
    expect(
      copiesOf(db, "plan-1")
        .map((c) => c.athlete_id)
        .sort(),
    ).toEqual([GRETA, TOBIAS].sort());
  });

  it("leaves a plan an athlete is practising as theirs, history and all", async () => {
    const db = squad({ athlete_id: GRETA, status: "active" });
    db.table("plan_sessions").push({
      id: "s1",
      plan_id: "plan-1",
      athlete_id: GRETA,
      state_index: 2,
    });
    const s = spies();
    const result = await sharePlanFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA, TOBIAS], activate: true },
      NOW,
      s.announce,
    );

    expect(result.id).not.toBe("plan-1");
    expect(result.shared).toBe(2);
    const gretas = db.table("plans").find((p) => p.id === "plan-1") as Row;
    expect(gretas.athlete_id).toBe(GRETA);
    expect(gretas.status).toBe("active");
    expect(gretas.shared_from_id).toBe(result.id);
    const source = db.table("plans").find((p) => p.id === result.id) as Row;
    expect(source.athlete_id).toBeNull();
    expect(source.status).toBe("active");
    expect(movesOf(db, result.id).length).toBe(2);
    // Only the athlete who is new to the plan is told.
    expect(s.activated.map((a) => a.athleteId)).toEqual([TOBIAS]);
  });

  it("makes a new plan from a template and leaves the template alone", async () => {
    const db = squad({ kind: "template", status: "benched" });
    const result = await sharePlanFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA, TOBIAS], activate: true },
      NOW,
      spies().announce,
    );
    const template = db.table("plans").find((p) => p.id === "plan-1") as Row;
    expect(template.kind).toBe("template");
    expect(template.status).toBe("benched");
    expect(result.id).not.toBe("plan-1");
    expect((db.table("plans").find((p) => p.id === result.id) as Row).kind).toBe("plan");
    expect(copiesOf(db, result.id).length).toBe(2);
    expect(copiesOf(db, "plan-1")).toEqual([]);
  });

  it("never makes a second copy for an athlete, and adds only who is new", async () => {
    const db = squad();
    const s = spies();
    const input = { athleteIds: [GRETA, TOBIAS], activate: true };
    await sharePlanFor(db.client, COACH, "plan-1", input, NOW, s.announce);
    await sharePlanFor(db.client, COACH, "plan-1", input, NOW, s.announce);
    expect(copiesOf(db, "plan-1").length).toBe(2);
    expect(s.activated.length).toBe(2);

    const again = await sharePlanFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA, ELSIE], activate: true },
      NOW,
      s.announce,
    );
    expect(again.shared).toBe(3);
    expect(s.activated.map((a) => a.athleteId)).toEqual([GRETA, TOBIAS, ELSIE]);
  });

  it("takes the chosen athletes' waiting drafts live when the coach activates", async () => {
    const db = squad();
    const s = spies();
    await sharePlanFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA, TOBIAS], activate: false },
      NOW,
      s.announce,
    );
    await sharePlanFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA, TOBIAS], activate: true },
      NOW,
      s.announce,
    );
    expect(copiesOf(db, "plan-1").map((c) => c.status)).toEqual(["active", "active"]);
    expect(s.activated.length).toBe(2);
  });
});

/** A live plan four athletes have, as `squad` + a share leaves it. */
async function sharedWithFour() {
  const db = squad();
  await sharePlanFor(
    db.client,
    COACH,
    "plan-1",
    { athleteIds: [GRETA, TOBIAS, ELSIE, MAEVE], activate: true },
    NOW,
    spies().announce,
  );
  return db;
}

const sourceOf = (db: ReturnType<typeof memoryDb>) =>
  db.table("plans").find((p) => p.id === "plan-1") as {
    id: string;
    title: string;
    notes: string;
    feedback_scope: string;
    shared_synced: never;
  };
const info = (db: ReturnType<typeof memoryDb>) =>
  loadShareInfo(db.client, COACH, sourceOf(db), movesOf(db, "plan-1") as never);

describe("what the coach sees on a plan several athletes have", () => {
  it("lists every athlete by name with nothing to send right after sharing", async () => {
    const db = await sharedWithFour();
    const share = await info(db);
    expect(share?.sharedWith.map((s) => s.name)).toEqual([
      "Elsie Varga",
      "Greta Halvorsen",
      "Maeve Abbott",
      "Tobias Fairbank",
    ]);
    expect(share?.sharedWith.every((s) => !s.tailored && !s.behind)).toBe(true);
    expect(share?.pendingChanges).toEqual([]);
  });

  it("is null for a plan nobody has a copy of", async () => {
    const db = squad();
    expect(await info(db)).toBeNull();
  });

  it("flags custom edits on the one copy the coach changed", async () => {
    const db = await sharedWithFour();
    const maeves = copyFor(db, "plan-1", MAEVE);
    (movesOf(db, maeves.id as string)[0] as Row).target_value = 5;
    const share = await info(db);
    expect(share?.sharedWith.filter((s) => s.tailored).map((s) => s.name)).toEqual([
      "Maeve Abbott",
    ]);
    expect(share?.sharedWith.some((s) => s.behind)).toBe(false);
  });

  it("says what changed, and that every copy is behind, once the coach edits the plan", async () => {
    const db = await sharedWithFour();
    (movesOf(db, "plan-1")[0] as Row).target_value = 5;
    db.table("plan_moves").push(moveRow("plan-1", 2, "Ankle hops", { id: "new-move" }));
    const share = await info(db);
    expect(share?.sharedWith.every((s) => s.behind)).toBe(true);
    expect(share?.pendingChanges).toEqual([
      { planMoveId: "plan-1-m0", name: "Jump rope", change: "minutes" },
      { planMoveId: "new-move", name: "Ankle hops", change: "new" },
    ]);
  });

  it("adds up the practice logged on the copies", async () => {
    const db = await sharedWithFour();
    const greta = copyFor(db, "plan-1", GRETA);
    const elsie = copyFor(db, "plan-1", ELSIE);
    db.table("plan_sessions").push(
      { id: "s1", plan_id: greta.id, athlete_id: GRETA, state_index: 2 },
      { id: "s2", plan_id: greta.id, athlete_id: GRETA, state_index: 2 },
      { id: "s3", plan_id: elsie.id, athlete_id: ELSIE, state_index: 0 },
    );
    const share = await info(db);
    expect(share?.sessions.sessionsTotal).toBe(3);
    expect(share?.sharedWith.find((s) => s.athleteId === GRETA)?.sessionsTotal).toBe(2);
  });

  it("counts copies for the plans list", async () => {
    const db = await sharedWithFour();
    const map = await loadCopyIdsByPlan(db.client, COACH, ["plan-1", "other"]);
    expect(map.get("plan-1")?.length).toBe(4);
    expect(map.has("other")).toBe(false);
  });
});

describe("Update & Share", () => {
  /** The coach lengthens the first move, drops the second, and adds a third. */
  function editPlan(db: ReturnType<typeof memoryDb>) {
    (movesOf(db, "plan-1")[0] as Row).target_value = 5;
    db.tables.plan_moves = db.table("plan_moves").filter((m) => m.id !== "plan-1-m1");
    db.table("plan_moves").push(moveRow("plan-1", 1, "Ankle hops", { id: "new-move" }));
    (db.table("plans").find((p) => p.id === "plan-1") as Row).title = "Off-ice warm-up v2";
  }

  it("makes the chosen copies match, keeps kept moves' rows, and leaves the others alone", async () => {
    const db = await sharedWithFour();
    const greta = copyFor(db, "plan-1", GRETA);
    const maeve = copyFor(db, "plan-1", MAEVE);
    const keptRowId = movesOf(db, greta.id as string)[0].id;
    editPlan(db);
    const s = spies();

    const result = await updateCopiesFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA, TOBIAS, ELSIE] },
      NOW,
      s.announce,
    );

    expect(result).toEqual({ ok: true, updated: 3 });
    const gretaMoves = movesOf(db, greta.id as string);
    expect(gretaMoves.map((m) => [m.name, Number(m.target_value)])).toEqual([
      ["Jump rope", 5],
      ["Ankle hops", 3],
    ]);
    // The move she already had keeps its row, so its practice ratings stay attached.
    expect(gretaMoves[0].id).toBe(keptRowId);
    expect((copyFor(db, "plan-1", GRETA) as Row).title).toBe("Off-ice warm-up v2");
    expect(movesOf(db, maeve.id as string).map((m) => m.name)).toEqual([
      "Jump rope",
      "Arm circles",
    ]);
    expect(s.updated.map((u) => u.athleteId).sort()).toEqual([GRETA, TOBIAS, ELSIE].sort());

    const share = await info(db);
    expect(share?.pendingChanges).toEqual([]);
    expect(share?.sharedWith.filter((x) => x.behind).map((x) => x.name)).toEqual(["Maeve Abbott"]);
  });

  it("records what changed for the athlete, by the copy's own move ids", async () => {
    const db = await sharedWithFour();
    editPlan(db);
    await updateCopiesFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA] },
      NOW,
      spies().announce,
    );
    const greta = copyFor(db, "plan-1", GRETA);
    const [first, second] = movesOf(db, greta.id as string);
    expect(greta.shared_changes).toEqual({
      at: NOW.toISOString(),
      moves: { [first.id as string]: "minutes", [second.id as string]: "new" },
    });
  });

  it("replaces a copy's custom edits only when its athlete is chosen", async () => {
    const db = await sharedWithFour();
    const maeve = copyFor(db, "plan-1", MAEVE);
    (movesOf(db, maeve.id as string)[0] as Row).target_value = 9;
    editPlan(db);
    await updateCopiesFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA] },
      NOW,
      spies().announce,
    );
    expect(Number(movesOf(db, maeve.id as string)[0].target_value)).toBe(9);

    await updateCopiesFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [MAEVE] },
      NOW,
      spies().announce,
    );
    expect(Number(movesOf(db, maeve.id as string)[0].target_value)).toBe(5);
    const settled = (await info(db))?.sharedWith.filter((x) => !x.tailored && !x.behind);
    expect(settled?.map((x) => x.name)).toEqual(["Greta Halvorsen", "Maeve Abbott"]);
  });

  it("tells nobody twice: a repeat changes nothing", async () => {
    const db = await sharedWithFour();
    editPlan(db);
    const s = spies();
    const input = { athleteIds: [GRETA, TOBIAS] };
    await updateCopiesFor(db.client, COACH, "plan-1", input, NOW, s.announce);
    const again = await updateCopiesFor(db.client, COACH, "plan-1", input, NOW, s.announce);
    expect(again.updated).toBe(0);
    expect(s.updated.length).toBe(2);
  });

  it("updates a draft copy without telling the household", async () => {
    const db = squad();
    await sharePlanFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA, TOBIAS], activate: false },
      NOW,
      spies().announce,
    );
    editPlan(db);
    const s = spies();
    const result = await updateCopiesFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA, TOBIAS] },
      NOW,
      s.announce,
    );
    expect(result.updated).toBe(2);
    expect(s.updated).toEqual([]);
  });

  it("uses the same number of requests for three copies as for one", async () => {
    const one = await sharedWithFour();
    editPlan(one);
    one.requests.length = 0;
    await updateCopiesFor(
      one.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA] },
      NOW,
      spies().announce,
    );
    const three = await sharedWithFour();
    editPlan(three);
    three.requests.length = 0;
    await updateCopiesFor(
      three.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA, TOBIAS, ELSIE] },
      NOW,
      spies().announce,
    );
    expect(three.requests.length).toBe(one.requests.length);
  });

  it("skips a copy whose athlete has left the roster", async () => {
    const db = await sharedWithFour();
    db.tables.coach_athletes = db.table("coach_athletes").filter((r) => r.athlete_id !== TOBIAS);
    editPlan(db);
    const s = spies();
    const result = await updateCopiesFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA, TOBIAS] },
      NOW,
      s.announce,
    );
    expect(result.updated).toBe(1);
    expect(s.updated.map((u) => u.athleteId)).toEqual([GRETA]);
  });

  it("refuses when none of the athletes has a copy", async () => {
    const db = squad();
    const err = await caught(() =>
      updateCopiesFor(db.client, COACH, "plan-1", { athleteIds: [GRETA] }, NOW, spies().announce),
    );
    expect(err?.status).toBe(422);
  });
});

describe("status and delete follow the plan to its copies", () => {
  it("takes waiting drafts live with the plan", async () => {
    const db = squad();
    await sharePlanFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA, TOBIAS], activate: false },
      NOW,
      spies().announce,
    );
    const moved = await cascadeStatusToCopies(db.client, COACH, "plan-1", "draft", "active");
    expect(moved.length).toBe(2);
    expect(copiesOf(db, "plan-1").every((c) => c.status === "active")).toBe(true);
  });

  it("benches the live copies, and brings the benched ones back on a restore", async () => {
    const db = await sharedWithFour();
    expect(
      (await cascadeStatusToCopies(db.client, COACH, "plan-1", "active", "benched")).length,
    ).toBe(4);
    expect(copiesOf(db, "plan-1").every((c) => c.status === "benched")).toBe(true);
    expect(
      (await cascadeStatusToCopies(db.client, COACH, "plan-1", "benched", "active")).length,
    ).toBe(4);
    expect(copiesOf(db, "plan-1").every((c) => c.status === "active")).toBe(true);
  });

  it("restores only the copies deleted with the plan, not one the coach deleted earlier", async () => {
    const db = await sharedWithFour();
    const ctx = { userId: "user-1", supabase: db.client };
    // Greta's copy was deleted on its own, a week before the whole plan.
    Object.assign(copyFor(db, "plan-1", GRETA), {
      status: "benched",
      deleted_at: "2026-11-03T10:00:00.000000+00:00",
    });
    Object.assign(db.table("plans").find((p) => p.id === "plan-1") as Row, {
      status: "benched",
      deleted_at: "2026-11-10T10:00:00.000000+00:00",
    });
    for (const athlete of [TOBIAS, ELSIE, MAEVE]) {
      Object.assign(copyFor(db, "plan-1", athlete), {
        status: "benched",
        deleted_at: "2026-11-10T10:00:00.412000+00:00",
      });
    }
    const told: string[] = [];
    await setPlanStatus(
      ctx,
      "plan-1",
      { status: "active" },
      undefined,
      undefined,
      async (_coach, plans) => void told.push(...plans.map((p) => p.athleteId)),
    );
    expect(copyFor(db, "plan-1", GRETA).status).toBe("benched");
    for (const athlete of [TOBIAS, ELSIE, MAEVE]) {
      expect(copyFor(db, "plan-1", athlete).status).toBe("active");
    }
    expect(told.sort()).toEqual([TOBIAS, ELSIE, MAEVE].sort());
  });

  it("starts a template saved as a plan as a draft, never as a deleted plan", async () => {
    const db = squad({ kind: "template", status: "benched" });
    await savePlan(
      { userId: "user-1", supabase: db.client },
      {
        id: "plan-1",
        title: "Off-ice warm-up",
        notes: "",
        kind: "plan",
        athleteId: GRETA,
        moves: [],
      },
    );
    const row = db.table("plans").find((p) => p.id === "plan-1") as Row;
    expect(row.kind).toBe("plan");
    expect(row.status).toBe("draft");
  });

  it("starts a template turned into a plan by a patch as a draft too", async () => {
    const db = squad({ kind: "template", status: "benched" });
    await updatePlan({ userId: "user-1", supabase: db.client }, "plan-1", {
      kind: "plan",
      athleteId: GRETA,
    });
    const row = db.table("plans").find((p) => p.id === "plan-1") as Row;
    expect(row.kind).toBe("plan");
    expect(row.athlete_id).toBe(GRETA);
    expect(row.status).toBe("draft");
  });

  it("leaves a copy alone when its athlete has left the roster", async () => {
    const db = await sharedWithFour();
    db.tables.coach_athletes = db.table("coach_athletes").filter((r) => r.athlete_id !== MAEVE);
    const moved = await cascadeStatusToCopies(db.client, COACH, "plan-1", "active", "benched");
    expect(moved.map((m) => m.athlete_id)).not.toContain(MAEVE);
    expect(copyFor(db, "plan-1", MAEVE).status).toBe("active");
  });

  it("benching the plan through the API benches each copy and records the why for each athlete", async () => {
    const db = await sharedWithFour();
    const recorded: CoachReasonInput[] = [];
    await setPlanStatus(
      { userId: "user-1", supabase: db.client },
      "plan-1",
      { status: "benched", reason: "landed_it" },
      async (input) => void recorded.push(input),
    );
    expect(sourceOf(db)).toMatchObject({ status: "benched" });
    expect(copiesOf(db, "plan-1").every((c) => c.status === "benched")).toBe(true);
    expect(recorded.map((r) => r.athleteId).sort()).toEqual([GRETA, TOBIAS, ELSIE, MAEVE].sort());
  });

  it("activating a draft plan through the API takes its copies live and tells each household", async () => {
    const db = squad();
    await sharePlanFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA, TOBIAS], activate: false },
      NOW,
      spies().announce,
    );
    const told: string[] = [];
    await setPlanStatus(
      { userId: "user-1", supabase: db.client },
      "plan-1",
      { status: "active" },
      undefined,
      undefined,
      async (_coach, plans) => void told.push(...plans.map((p) => p.athleteId)),
    );
    expect(copiesOf(db, "plan-1").every((c) => c.status === "active")).toBe(true);
    expect(told.sort()).toEqual([GRETA, TOBIAS].sort());
  });

  it("deleting a draft plan removes its draft copies but keeps one that went live", async () => {
    const db = squad();
    await sharePlanFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA, TOBIAS], activate: false },
      NOW,
      spies().announce,
    );
    copyFor(db, "plan-1", TOBIAS).status = "active";
    const tobiasPlanId = copyFor(db, "plan-1", TOBIAS).id;
    await deletePlan({ userId: "user-1", supabase: db.client }, "plan-1");
    const left = db.table("plans");
    expect(left.map((p) => p.id)).toEqual([tobiasPlanId]);
    expect(left[0].shared_from_id).toBeNull();
  });

  it("deleteDraftCopies touches only this plan's drafts", async () => {
    const db = await sharedWithFour();
    await deleteDraftCopies(db.client, COACH, "plan-1");
    expect(copiesOf(db, "plan-1").length).toBe(4);
  });
});

describe("the plans list and plan screen", () => {
  it("shows the plan with its athlete count and each copy with where it came from", async () => {
    const db = await sharedWithFour();
    const greta = copyFor(db, "plan-1", GRETA);
    db.table("plan_sessions").push({
      id: "s1",
      plan_id: greta.id,
      athlete_id: GRETA,
      state_index: 2,
    });
    const plans = await listPlans({ userId: "user-1", supabase: db.client }, {});
    const source = plans.find((p) => p.id === "plan-1");
    expect(source?.sharedCount).toBe(4);
    expect(source?.sessionsTotal).toBe(1);
    expect(source?.sharedFromId).toBeUndefined();
    const copy = plans.find((p) => p.id === greta.id);
    expect(copy?.sharedFromId).toBe("plan-1");
    expect(copy?.sharedCount).toBeUndefined();
  });

  it("serves the copies on the plan, and the link back on a copy", async () => {
    const db = await sharedWithFour();
    const ctx = { userId: "user-1", supabase: db.client };
    const source = await getPlan(ctx, "plan-1");
    expect(source.sharedWith?.length).toBe(4);
    expect(source.pendingChanges).toEqual([]);
    const copy = await getPlan(ctx, copyFor(db, "plan-1", GRETA).id as string);
    expect(copy.sharedFromId).toBe("plan-1");
    expect(copy.sharedWith).toBeUndefined();
  });

  it("says when a deleted plan will be removed, and never for a template", async () => {
    const db = squad({
      athlete_id: GRETA,
      status: "benched",
      deleted_at: "2026-11-11T09:00:00.000Z",
    });
    // A template rests at 'benched' too; even with a time on its row it is never "deleted".
    db.table("plans").push(
      planRow({
        id: "template-1",
        kind: "template",
        status: "benched",
        deleted_at: "2026-11-11T09:00:00.000Z",
      }),
    );
    const ctx = { userId: "user-1", supabase: db.client };
    const plans = await listPlans(ctx, {});
    expect(plans.find((p) => p.id === "plan-1")?.purgeAt).toBe("2026-12-11T09:00:00.000Z");
    const template = plans.find((p) => p.id === "template-1");
    expect(template?.kind).toBe("template");
    expect("purgeAt" in (template as object)).toBe(false);
    expect((await getPlan(ctx, "plan-1")).purgeAt).toBe("2026-12-11T09:00:00.000Z");
  });

  it("adds nothing to an ordinary plan", async () => {
    const db = squad({ athlete_id: GRETA, status: "active" });
    const plan = await getPlan({ userId: "user-1", supabase: db.client }, "plan-1");
    expect("sharedWith" in plan).toBe(false);
    expect("sharedFromId" in plan).toBe(false);
    expect("sharedCount" in plan).toBe(false);
  });
});

describe("what the athlete sees after an update", () => {
  it("serves the change tags until practice is next logged", async () => {
    const db = memoryDb({
      plans: [
        planRow({
          id: "copy-1",
          athlete_id: GRETA,
          status: "active",
          shared_changes: { at: "2026-11-10T12:00:00.000Z", moves: { m1: "minutes", m5: "new" } },
        }),
      ],
      plan_sessions: [{ id: "old", plan_id: "copy-1", created_at: "2026-11-09T09:00:00.000Z" }],
    });
    expect(await loadUpdatedMoves(db.client, "copy-1")).toEqual({ m1: "minutes", m5: "new" });
    db.table("plan_sessions").push({
      id: "s",
      plan_id: "copy-1",
      created_at: "2026-11-11T09:00:00.000Z",
    });
    expect(await loadUpdatedMoves(db.client, "copy-1")).toBeNull();
  });

  it("is null for a plan that never received an update", async () => {
    const db = memoryDb({ plans: [planRow({ id: "p", athlete_id: GRETA })], plan_sessions: [] });
    expect(await loadUpdatedMoves(db.client, "p")).toBeNull();
  });
});

/**
 * What the adversarial review of 2026-11-12 found: each test is the scenario
 * that went wrong, run against the fake's row cap, upsert, unique-index, and
 * roster-policy behaviour.
 */
describe("at squad size, under a race, and after a failure", () => {
  const SQUAD = Array.from(
    { length: 150 },
    (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`,
  );
  /** 150 athletes and an eight-move plan: 1,208 move rows once shared, past the 1,000-row cap. */
  function bigSquad() {
    return memoryDb(
      {
        coach_profiles: [{ id: COACH, user_id: "user-1" }],
        coach_athletes: SQUAD.map((athlete_id) => ({ coach_id: COACH, athlete_id })),
        athletes: SQUAD.map((id, i) => ({ id, first_name: "Skater", last_name: String(i) })),
        plans: [planRow({ id: "plan-1" })],
        plan_moves: Array.from({ length: 8 }, (_, i) => moveRow("plan-1", i, `Move ${i + 1}`)),
        plan_sessions: [],
      },
      { maxRows: 1000 },
    );
  }

  it("updates every copy of a 150-athlete plan correctly past the row cap", async () => {
    const db = bigSquad();
    const s = spies();
    await sharePlanFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: SQUAD, activate: true },
      NOW,
      s.announce,
    );
    expect(copiesOf(db, "plan-1").length).toBe(150);

    (movesOf(db, "plan-1")[7] as Row).target_value = 9;
    const result = await updateCopiesFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: SQUAD },
      NOW,
      s.announce,
    );

    expect(result.updated).toBe(150);
    for (const copy of copiesOf(db, "plan-1")) {
      const moves = movesOf(db, copy.id as string);
      expect(moves.map((m) => m.name)).toEqual(
        Array.from({ length: 8 }, (_, i) => `Move ${i + 1}`),
      );
      expect(moves[7].target_value).toBe(9);
    }
    expect(s.updated.length).toBe(150);
    // No id list longer than a hundred ever travels in a URL.
    expect(db.stats.longestIn).toBeLessThanOrEqual(100);
  });

  it("lists every plan with the right move count past the row cap", async () => {
    const db = bigSquad();
    await sharePlanFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: SQUAD, activate: true },
      NOW,
      spies().announce,
    );
    const plans = await listPlans({ userId: "user-1", supabase: db.client }, {});
    expect(plans.length).toBe(151);
    expect(plans.every((p) => p.moveCount === 8)).toBe(true);
    expect(plans.find((p) => p.id === "plan-1")?.sharedCount).toBe(150);
    expect(db.stats.longestIn).toBeLessThanOrEqual(100);
  });

  it("adds athletes to the same plan when the coach shares again from one athlete's copy", async () => {
    const db = squad({ status: "active", athlete_id: GRETA });
    const s = spies();
    const first = await sharePlanFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA, TOBIAS], activate: true },
      NOW,
      s.announce,
    );
    expect(first.id).not.toBe("plan-1");

    const second = await sharePlanFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA, TOBIAS, ELSIE], activate: true },
      NOW,
      s.announce,
    );

    expect(second).toEqual({ id: first.id, shared: 3 });
    expect(db.table("plans").filter((p) => !p.athlete_id).length).toBe(1);
    expect(db.table("plans").filter((p) => p.athlete_id === TOBIAS).length).toBe(1);
    expect(s.activated.filter((a) => a.athleteId === TOBIAS).length).toBe(1);
    expect(s.activated.filter((a) => a.athleteId === ELSIE).length).toBe(1);
  });

  it("gives each athlete one copy when two requests race", async () => {
    const db = squad();
    const s = spies();
    const share = () =>
      sharePlanFor(
        db.client,
        COACH,
        "plan-1",
        { athleteIds: [GRETA, TOBIAS], activate: true },
        NOW,
        s.announce,
      );
    const results = await Promise.allSettled([share(), share()]);

    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((refused.reason as ApiError).status).toBe(409);
    expect(copiesOf(db, "plan-1").length).toBe(2);
    expect(s.activated.length).toBe(2);
  });

  it("takes back the plan it made when the share fails, so a retry makes one, not two", async () => {
    const db = squad({ kind: "template", status: "benched" }, undefined, {
      failOn: { request: "plan_moves.insert", nth: 2 },
    });
    const s = spies();
    const share = () =>
      sharePlanFor(
        db.client,
        COACH,
        "plan-1",
        { athleteIds: [GRETA, TOBIAS], activate: true },
        NOW,
        s.announce,
      );

    await expect(share()).rejects.toThrow();
    expect(db.table("plans").map((p) => p.id)).toEqual(["plan-1"]);
    expect(s.activated.length).toBe(0);

    const retry = await share();
    expect(db.table("plans").filter((p) => p.kind === "plan" && !p.athlete_id).length).toBe(1);
    expect(copiesOf(db, retry.id).length).toBe(2);
    expect(s.activated.length).toBe(2);
  });

  it("treats a draft that was practised as its athlete's own, history and all", async () => {
    const db = squad({ status: "draft", athlete_id: GRETA });
    db.table("plan_sessions").push({
      id: "s1",
      plan_id: "plan-1",
      athlete_id: GRETA,
      state_index: 1,
    });
    const result = await sharePlanFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA, TOBIAS], activate: false },
      NOW,
      spies().announce,
    );
    const own = db.table("plans").find((p) => p.id === "plan-1") as Row;
    expect(result.id).not.toBe("plan-1");
    expect(own.athlete_id).toBe(GRETA);
    expect(own.shared_from_id).toBe(result.id);
  });

  it("gives a draft back to its athlete when sharing it fails", async () => {
    const db = squad({ status: "draft", athlete_id: GRETA }, undefined, {
      failOn: { request: "plan_moves.insert", nth: 1 },
    });
    await expect(
      sharePlanFor(
        db.client,
        COACH,
        "plan-1",
        { athleteIds: [GRETA, TOBIAS], activate: true },
        NOW,
        spies().announce,
      ),
    ).rejects.toThrow();
    expect(db.table("plans").length).toBe(1);
    expect((db.table("plans")[0] as Row).athlete_id).toBe(GRETA);
  });

  it("cuts one plan, not two, when two requests race to share an athlete's live plan", async () => {
    const db = squad({ status: "active", athlete_id: GRETA });
    const s = spies();
    const share = () =>
      sharePlanFor(
        db.client,
        COACH,
        "plan-1",
        { athleteIds: [GRETA, TOBIAS], activate: true },
        NOW,
        s.announce,
      );
    const results = await Promise.allSettled([share(), share()]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(db.table("plans").filter((p) => !p.athlete_id).length).toBe(1);
    expect(db.table("plans").filter((p) => p.athlete_id === TOBIAS).length).toBe(1);
    expect(s.activated.length).toBe(1);

    // The one that lost is told to retry, and the retry adds to the same plan.
    const retry = await share();
    expect(db.table("plans").filter((p) => !p.athlete_id).map((p) => p.id)).toEqual([retry.id]);
    expect(db.table("plans").filter((p) => p.athlete_id === TOBIAS).length).toBe(1);
  });

  it("tells the households whose copies went live even when the plan's own write then fails", async () => {
    const db = squad({}, undefined, { failOn: { request: "plans.update", nth: 3 } });
    await sharePlanFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA, TOBIAS], activate: false },
      NOW,
      spies().announce,
    );
    const told: string[] = [];
    const activate = () =>
      setPlanStatus(
        { userId: "user-1", supabase: db.client },
        "plan-1",
        { status: "active" },
        undefined,
        undefined,
        async (_coach, plans) => void told.push(...plans.map((p) => p.athleteId)),
      );
    // The copies go live (update 2), then the plan's own update (3) fails.
    await expect(activate()).rejects.toThrow();
    expect(copiesOf(db, "plan-1").every((c) => c.status === "active")).toBe(true);
    expect(told.sort()).toEqual([GRETA, TOBIAS].sort());

    await activate();
    expect((db.table("plans").find((p) => p.id === "plan-1") as Row).status).toBe("active");
    expect(told.length).toBe(2);
  });

  it("starts 'what changed' afresh when one athlete's draft becomes the plan for several", async () => {
    const db = squad({
      status: "draft",
      athlete_id: GRETA,
      shared_synced: { title: "An older plan", notes: "", feedbackScope: "plan", moves: [] },
    });
    await sharePlanFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA, TOBIAS], activate: false },
      NOW,
      spies().announce,
    );
    const source = db.table("plans").find((p) => p.id === "plan-1") as Row;
    const info = await loadShareInfo(
      db.client,
      COACH,
      source as never,
      movesOf(db, "plan-1") as never,
    );
    expect(info?.pendingChanges).toEqual([]);
  });

  it("still tells the household when an update failed half-way and is sent again", async () => {
    const db = await sharedWithFour();
    const tobias = copyFor(db, "plan-1", TOBIAS);
    const greta = copyFor(db, "plan-1", GRETA);
    greta.shared_changes = { at: "2026-11-09T00:00:00Z", moves: { kept: "minutes" } };
    (movesOf(db, "plan-1")[0] as Row).target_value = 7;

    // The moves are written, then the write that marks the copy as updated fails.
    const flaky = { ...db.client };
    let failed = false;
    flaky.from = (name: string) => {
      const b = db.client.from(name);
      if (name !== "plans" || failed) return b;
      const upsert = b.upsert;
      b.upsert = (rows: Row[]) => {
        failed = true;
        upsert(rows);
        return { then: (r: (v: unknown) => void) => r({ data: null, error: { code: "XX000" } }) };
      };
      return b;
    };
    const s = spies();
    await expect(
      updateCopiesFor(flaky, COACH, "plan-1", { athleteIds: [TOBIAS] }, NOW, s.announce),
    ).rejects.toThrow();
    expect(movesOf(db, tobias.id as string)[0].target_value).toBe(7);
    expect(s.updated.length).toBe(0);

    // Sent again, with an athlete whose copy still needs the change.
    const result = await updateCopiesFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [TOBIAS, ELSIE] },
      NOW,
      s.announce,
    );
    expect(result.updated).toBe(2);
    expect(s.updated.map((u) => u.athleteId).sort()).toEqual([TOBIAS, ELSIE].sort());
    // Greta was not chosen: her change tags are untouched by the others' write.
    expect(copyFor(db, "plan-1", GRETA).shared_changes).toEqual({
      at: "2026-11-09T00:00:00Z",
      moves: { kept: "minutes" },
    });
  });

  it("keeps a copy's change tags when it is settled in the same write as a changed one", async () => {
    const db = await sharedWithFour();
    const tobias = copyFor(db, "plan-1", TOBIAS);
    (movesOf(db, "plan-1")[0] as Row).target_value = 7;
    // Tobias's copy already says what the plan says, but is not marked as having received it.
    (movesOf(db, tobias.id as string)[0] as Row).target_value = 7;
    tobias.shared_changes = { at: "2026-11-09T00:00:00Z", moves: { kept: "new" } };

    await updateCopiesFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [TOBIAS, ELSIE] },
      NOW,
      spies().announce,
    );
    expect(copyFor(db, "plan-1", TOBIAS).shared_changes).toEqual({
      at: "2026-11-09T00:00:00Z",
      moves: { kept: "new" },
    });
    expect(copyFor(db, "plan-1", ELSIE).shared_changes).not.toBeNull();
  });

  it("finishes benching the copies when the first attempt benched only the plan", async () => {
    const db = await sharedWithFour();
    (db.table("plans").find((p) => p.id === "plan-1") as Row).status = "benched";
    const why: CoachReasonInput[] = [];
    await setPlanStatus(
      { userId: "user-1", supabase: db.client },
      "plan-1",
      { status: "benched", reason: "changed_direction" },
      async (input) => void why.push(input),
    );
    expect(copiesOf(db, "plan-1").every((c) => c.status === "benched")).toBe(true);
    expect(why.length).toBe(4);
  });

  it("leaves the plan a draft when taking its copies live fails, so a retry does it all", async () => {
    const db = squad({}, undefined, { failOn: { request: "plans.update", nth: 2 } });
    await sharePlanFor(
      db.client,
      COACH,
      "plan-1",
      { athleteIds: [GRETA, TOBIAS], activate: false },
      NOW,
      spies().announce,
    );
    const ctx = { userId: "user-1", supabase: db.client };
    const told: string[] = [];
    const activate = () =>
      setPlanStatus(
        ctx,
        "plan-1",
        { status: "active" },
        undefined,
        undefined,
        async (_coach, plans) => void told.push(...plans.map((p) => p.athleteId)),
      );

    await expect(activate()).rejects.toThrow();
    expect((db.table("plans").find((p) => p.id === "plan-1") as Row).status).toBe("draft");

    await activate();
    expect(db.table("plans").every((p) => p.status === "active")).toBe(true);
    expect(told.sort()).toEqual([GRETA, TOBIAS].sort());
  });

  it("does not hand a shared plan, or a copy of it, to an athlete named in a voice edit", async () => {
    const db = await sharedWithFour();
    const draft = { title: "Off-ice warm-up v2", athleteId: GRETA, moves: [] };
    await applyDraft(db.client, COACH, "edit", "plan-1", draft, "make it for Greta");
    const source = db.table("plans").find((p) => p.id === "plan-1") as Row;
    expect(source.title).toBe("Off-ice warm-up v2");
    expect(source.athlete_id).toBeNull();

    const tobias = copyFor(db, "plan-1", TOBIAS);
    await applyDraft(db.client, COACH, "edit", tobias.id as string, draft, "make it for Greta");
    expect(copyFor(db, "plan-1", TOBIAS).athlete_id).toBe(TOBIAS);
    expect(copiesOf(db, "plan-1").length).toBe(4);
  });

  it("keeps a shared plan live through an edit, and refuses to hand it to one athlete", async () => {
    const db = await sharedWithFour();
    const ctx = { userId: "user-1", supabase: db.client };

    await updatePlan(ctx, "plan-1", { title: "Off-ice warm-up v2" });
    const source = db.table("plans").find((p) => p.id === "plan-1") as Row;
    expect(source.title).toBe("Off-ice warm-up v2");
    expect(source.status).toBe("active");

    const patched = await caught(() => updatePlan(ctx, "plan-1", { athleteId: GRETA }));
    expect(patched?.status).toBe(409);
    const saved = await caught(() =>
      savePlan(ctx, {
        id: "plan-1",
        title: "Off-ice warm-up",
        notes: "",
        kind: "plan",
        athleteId: GRETA,
        moves: [],
      }),
    );
    expect(saved?.status).toBe(409);
    expect((db.table("plans").find((p) => p.id === "plan-1") as Row).athlete_id).toBeNull();
    expect(copiesOf(db, "plan-1").length).toBe(4);
    expect(movesOf(db, "plan-1").length).toBe(2);
  });
});
