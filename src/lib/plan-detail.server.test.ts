import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import {
  addPlanMoveToLibrary,
  archiveMove,
  forkPlanMoveToLibrary,
  importMoves,
  listMoves,
  updateLibraryMoveFromPlanMove,
  upsertMove,
  type MovesContext,
} from "./moves.server";
import {
  getPlanForViewer,
  requirePlansCoach,
  resolvePlanViewer,
  resolvePlanViewerRole,
} from "./plan-detail.server";
import {
  addLibraryMovesToPlan,
  addMoveToPlan,
  createPlan,
  deletePlan,
  ensureCoachId,
  getAthleteActivePlans,
  getPlan,
  listCoachAthletes,
  listCoachSports,
  listPlans,
  reorderPlanMoves,
  removePlanMove,
  savePlan,
  setPlanStatus,
  sharePlan,
  updatePlan,
  updatePlanCopies,
  updatePlanMove,
  type PlansContext,
} from "./plans.server";

/* -------------------------------------------------------------------------- */
/* A recording fake that accepts any query-builder method. Test-only.         */
/* -------------------------------------------------------------------------- */

type Call = {
  table: string;
  op: "select" | "insert" | "update" | "delete" | "upsert" | "rpc";
  /** Every `.eq(column, value)`, in order. */
  eqs: [string, unknown][];
  /** Every argument given to any builder method (filters, payloads, rpc args). */
  args: unknown[];
};
type Answer = (call: Call) => { data?: unknown; error?: { code: string; message: string } } | void;

/**
 * Every query is logged when it is sent. `answer` gives what a query returns;
 * with none a single-row read finds nothing and a list is empty.
 */
function recorder(answer: Answer = () => {}) {
  const calls: Call[] = [];
  const settle = (call: Call, one: boolean) => {
    calls.push(call);
    const res = answer(call) ?? {};
    return { data: res.data ?? (one ? null : []), error: res.error ?? null, count: 0 };
  };
  const chain = (table: string) => {
    const call: Call = { table, op: "select", eqs: [], args: [] };
    const self: unknown = new Proxy(
      {},
      {
        get(_target, prop: string) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve(settle(call, false));
          }
          if (prop === "maybeSingle" || prop === "single") {
            return async () => settle(call, true);
          }
          return (...args: unknown[]) => {
            if (["insert", "update", "delete", "upsert"].includes(prop)) {
              call.op = prop as Call["op"];
            }
            if (prop === "eq") call.eqs.push([args[0] as string, args[1]]);
            call.args.push(...args);
            return self;
          };
        },
      },
    );
    return self;
  };
  const client = {
    from: chain,
    rpc: async (name: string, params?: unknown) =>
      settle({ table: name, op: "rpc", eqs: [], args: [params] }, false),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, calls };
}

const USER = "11111111-1111-4111-8111-111111111111";
const COACH = "22222222-2222-4222-8222-222222222222";
const PLAN = "33333333-3333-4333-8333-333333333333";
const MOVE = "44444444-4444-4444-8444-444444444444";
const PLAN_MOVE = "55555555-5555-4555-8555-555555555555";
const ATHLETE = "66666666-6666-4666-8666-666666666666";

/** Which profile rows the signed-in user has. */
function profiles(has: { coach?: boolean; parent?: boolean; athlete?: boolean }): Answer {
  return (call) => {
    if (call.op === "insert" && call.table === "coach_profiles")
      return { data: { id: "new-coach" } };
    if (call.op !== "select") return;
    if (call.table === "coach_profiles" && has.coach) return { data: { id: COACH } };
    if (call.table === "parent_profiles" && has.parent) return { data: { id: "parent-1" } };
    if (call.table === "athletes" && has.athlete) return { data: { id: "athlete-1" } };
  };
}

/** `table.op` for each query, in the order sent. */
const sent = (calls: Call[]) => calls.map((c) => `${c.table}.${c.op}`);
const coachReads = (calls: Call[]) =>
  calls.filter((c) => c.table === "coach_profiles" && c.op === "select");

async function thrown(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return null;
  } catch (err) {
    return err;
  }
}

/** Runs `fn` with `console.error` silenced (a refused read is logged). */
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const real = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = real;
  }
}

/* -------------------------------------------------------------------------- */
/* Who the caller is                                                          */
/* -------------------------------------------------------------------------- */

describe("resolvePlanViewer", () => {
  it("a coach profile wins and its id is handed back: one read", async () => {
    const db = recorder(profiles({ coach: true, parent: true, athlete: true }));
    expect(await resolvePlanViewer(db.client, USER)).toEqual({ role: "coach", coachId: COACH });
    expect(sent(db.calls)).toEqual(["coach_profiles.select"]);
    expect(db.calls[0]!.eqs).toEqual([["user_id", USER]]);
  });

  it("then a parent, then an athlete, with no coach id", async () => {
    const parent = recorder(profiles({ parent: true, athlete: true }));
    expect(await resolvePlanViewer(parent.client, USER)).toEqual({ role: "parent" });
    expect(sent(parent.calls)).toEqual(["coach_profiles.select", "parent_profiles.select"]);

    const athlete = recorder(profiles({ athlete: true }));
    expect(await resolvePlanViewer(athlete.client, USER)).toEqual({ role: "athlete" });
    expect(sent(athlete.calls)).toEqual([
      "coach_profiles.select",
      "parent_profiles.select",
      "athletes.select",
    ]);
  });

  it("a user with no profile is treated as a coach, with no coach id", async () => {
    const db = recorder(profiles({}));
    expect(await resolvePlanViewer(db.client, USER)).toEqual({ role: "coach" });
    expect(sent(db.calls)).toHaveLength(3);
  });

  it("resolvePlanViewerRole answers the same role", async () => {
    for (const [has, role] of [
      [{ coach: true }, "coach"],
      [{ parent: true }, "parent"],
      [{ athlete: true }, "athlete"],
      [{}, "coach"],
    ] as const) {
      expect(await resolvePlanViewerRole(recorder(profiles(has)).client, USER)).toBe(role);
    }
  });

  it("a failed read is thrown where it happens: nothing after it is read", async () => {
    for (const [table, before] of [
      ["coach_profiles", 1],
      ["parent_profiles", 2],
      ["athletes", 3],
    ] as const) {
      const db = recorder((call) =>
        call.table === table ? { error: { code: "57014", message: "timeout" } } : undefined,
      );
      const err = await quietly(() => thrown(() => resolvePlanViewer(db.client, USER)));
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("Something went wrong. Please try again.");
      expect(db.calls).toHaveLength(before);
    }
  });
});

describe("requirePlansCoach", () => {
  it("hands a coach's id on with the context", async () => {
    const db = recorder(profiles({ coach: true }));
    const ctx = await requirePlansCoach({ userId: USER, supabase: db.client });
    expect(ctx).toEqual({ userId: USER, supabase: db.client, coachId: COACH });
    expect(sent(db.calls)).toEqual(["coach_profiles.select"]);
  });

  it("refuses a parent and an athlete with 403 wrong_role, as before", async () => {
    for (const has of [{ parent: true }, { athlete: true }, { parent: true, athlete: true }]) {
      const db = recorder(profiles(has));
      const err = await thrown(() => requirePlansCoach({ userId: USER, supabase: db.client }));
      expect(err).toBeInstanceOf(ApiError);
      expect(err as ApiError).toMatchObject({
        status: 403,
        code: "wrong_role",
        message: "Not a coach",
      });
      // Nothing is written: no coach profile is made for them.
      expect(db.calls.every((c) => c.op === "select")).toBe(true);
    }
  });

  it("drops anything else on the context it is given, a coachId included", async () => {
    const db = recorder(profiles({}));
    const ctx = await requirePlansCoach({
      userId: USER,
      supabase: db.client,
      coachId: "not-this-users",
    } as { userId: string; supabase: typeof db.client });
    expect(ctx.coachId).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* A route: the check, then the shared function                               */
/* -------------------------------------------------------------------------- */

describe("a coach route reads the coach profile once", () => {
  it("plans: the check's read is the only one", async () => {
    const db = recorder((call) =>
      call.table === "coach_levels"
        ? { data: [{ sport: "tennis" }, { sport: "figure_skating" }] }
        : profiles({ coach: true })(call),
    );
    const coach = await requirePlansCoach({ userId: USER, supabase: db.client });

    expect(await listCoachSports(coach)).toEqual(["figure_skating", "tennis"]);
    // Two requests where there were three.
    expect(sent(db.calls)).toEqual(["coach_profiles.select", "coach_levels.select"]);
    expect(db.calls[1]!.eqs).toEqual([["coach_id", COACH]]);
  });

  it("moves: the check's read is the only one", async () => {
    const db = recorder(profiles({ coach: true }));
    const coach = await requirePlansCoach({ userId: USER, supabase: db.client });

    await quietly(() => thrown(() => archiveMove(coach, MOVE)));
    expect(coachReads(db.calls)).toHaveLength(1);
    expect(db.calls.length).toBeGreaterThan(1);
  });

  it("plan detail (GET /plans/{id}) as a coach: one read, then the plan", async () => {
    const db = recorder(profiles({ coach: true }));
    const admin = recorder();
    const err = await thrown(() =>
      getPlanForViewer({ userId: USER, supabase: db.client, admin: admin.client }, PLAN),
    );
    // No such plan in the fake: the coach loader's 404, as before.
    expect(err as ApiError).toMatchObject({ status: 404, code: "not_found" });
    expect(sent(db.calls).slice(0, 2)).toEqual(["coach_profiles.select", "plans.select"]);
    expect(coachReads(db.calls)).toHaveLength(1);
    expect(coachReads(admin.calls)).toHaveLength(0);
  });

  it("a user with no profile still gets one made, after the parent check", async () => {
    const db = recorder(profiles({}));
    const coach = await requirePlansCoach({ userId: USER, supabase: db.client });
    expect(coach.coachId).toBeUndefined();

    expect(await listCoachSports(coach)).toEqual([]);
    expect(sent(db.calls)).toEqual([
      // The check: no coach, no parent, no athlete.
      "coach_profiles.select",
      "parent_profiles.select",
      "athletes.select",
      // `ensureCoachId`, untouched: read, refuse a parent, create.
      "coach_profiles.select",
      "parent_profiles.select",
      "coach_profiles.insert",
      "coach_levels.select",
    ]);
    expect(db.calls[6]!.eqs).toEqual([["coach_id", "new-coach"]]);
  });

  it("a user with no profile reaches the move library as before: empty list, 422 on a write", async () => {
    const db = recorder(profiles({}));
    const coach = await requirePlansCoach({ userId: USER, supabase: db.client });

    expect(await listMoves(coach)).toEqual({ moves: [], seedCategories: [] });
    const err = await thrown(() => archiveMove(coach, MOVE));
    expect(err as ApiError).toMatchObject({
      status: 422,
      code: "unprocessable",
      message: "Coach profile not found",
    });
    // Each looked for the profile itself; neither created one.
    expect(coachReads(db.calls)).toHaveLength(3);
    expect(db.calls.every((c) => c.op === "select")).toBe(true);
  });

  it("a parent never reaches a plans or moves function", async () => {
    const db = recorder(profiles({ parent: true }));
    const err = await thrown(async () =>
      listCoachSports(await requirePlansCoach({ userId: USER, supabase: db.client })),
    );
    expect(err as ApiError).toMatchObject({ status: 403, code: "wrong_role" });
    expect(sent(db.calls)).toEqual(["coach_profiles.select", "parent_profiles.select"]);
  });
});

describe("ensureCoachId without a carried id (the web's path)", () => {
  it("returns the existing profile's id with one read", async () => {
    const db = recorder(profiles({ coach: true }));
    expect(await ensureCoachId(db.client, USER)).toBe(COACH);
    expect(sent(db.calls)).toEqual(["coach_profiles.select"]);
  });

  it("refuses a parent with 403 wrong_role and creates nothing", async () => {
    const db = recorder(profiles({ parent: true }));
    const err = await thrown(() => listCoachSports({ userId: USER, supabase: db.client }));
    expect(err as ApiError).toMatchObject({
      status: 403,
      code: "wrong_role",
      message: "This account is registered as a parent, not a coach.",
    });
    expect(sent(db.calls)).toEqual(["coach_profiles.select", "parent_profiles.select"]);
  });
});

/* -------------------------------------------------------------------------- */
/* Every shared function honours the carried id                               */
/* -------------------------------------------------------------------------- */

const noop = async () => {};
const SECOND_READ = "99999999-9999-4999-8999-999999999999";

/** A row for any table, owned by `coachId`; `coach_profiles` answers another id. */
function ownedBy(coachId: string): Answer {
  const row = {
    id: PLAN,
    coach_id: coachId,
    plan_id: PLAN,
    move_id: MOVE,
    athlete_id: ATHLETE,
    user_id: USER,
    kind: "plan",
    status: "draft",
    title: "Edges",
    name: "Waltz jump",
    sport: "figure_skating",
    category: "Jumps",
    description: "",
    cue: "",
    why: "",
    notes: "",
    position: 0,
    target_kind: "reps",
    target_value: 5,
    default_target_kind: "reps",
    default_target_value: 5,
    feedback_scope: "plan",
    updated_at: "2026-11-22T00:00:00.000Z",
    created_at: "2026-11-22T00:00:00.000Z",
    shared_from_id: null,
    deleted_at: null,
  };
  return (call) => {
    if (call.table === "coach_profiles") return { data: { id: SECOND_READ } };
    if (call.op === "rpc") return { data: [] };
    return {
      data:
        call.table === "plan_moves"
          ? { ...row, id: PLAN_MOVE, plans: { ...row }, moves: { ...row, id: MOVE } }
          : row,
    };
  };
}

const PLAN_FUNCTIONS: Record<string, (ctx: PlansContext) => Promise<unknown>> = {
  listCoachAthletes: (ctx) => listCoachAthletes(ctx),
  listCoachSports: (ctx) => listCoachSports(ctx),
  listPlans: (ctx) => listPlans(ctx, {}),
  getPlan: (ctx) => getPlan(ctx, PLAN),
  savePlan: (ctx) => savePlan(ctx, { id: PLAN, title: "Edges", notes: "", moves: [] } as never),
  getAthleteActivePlans: (ctx) => getAthleteActivePlans(ctx, ATHLETE),
  setPlanStatus: (ctx) =>
    setPlanStatus(ctx, PLAN, { status: "active" }, noop, async () => ctx.supabase, noop as never),
  sharePlan: (ctx) => sharePlan(ctx, PLAN, { athleteIds: [ATHLETE], status: "draft" } as never),
  updatePlanCopies: (ctx) => updatePlanCopies(ctx, PLAN, { copyIds: [PLAN] } as never),
  deletePlan: (ctx) => deletePlan(ctx, PLAN),
  createPlan: (ctx) => createPlan(ctx, { kind: "template", title: "Edges" } as never),
  addMoveToPlan: (ctx) => addMoveToPlan(ctx, PLAN, MOVE),
  updatePlan: (ctx) => updatePlan(ctx, PLAN, { title: "Edges" } as never),
  updatePlanMove: (ctx) => updatePlanMove(ctx, PLAN_MOVE, { cue: "Tall" } as never, PLAN),
  removePlanMove: (ctx) => removePlanMove(ctx, PLAN_MOVE, PLAN),
  reorderPlanMoves: (ctx) => reorderPlanMoves(ctx, PLAN, [PLAN_MOVE]),
  addLibraryMovesToPlan: (ctx) => addLibraryMovesToPlan(ctx, PLAN, [MOVE]),
};

const MOVE_FUNCTIONS: Record<string, (ctx: MovesContext) => Promise<unknown>> = {
  listMoves: (ctx) => listMoves(ctx),
  upsertMove: (ctx) =>
    upsertMove(ctx, {
      sport: "figure_skating",
      category: "Jumps",
      name: "Waltz jump",
      description: "",
      cue: "",
      why: "",
      defaultTargetKind: "reps",
      defaultTargetValue: 5,
    } as never),
  importMoves: (ctx) => importMoves(ctx, { rows: [] } as never),
  archiveMove: (ctx) => archiveMove(ctx, MOVE),
  addPlanMoveToLibrary: (ctx) => addPlanMoveToLibrary(ctx, { planMoveId: PLAN_MOVE } as never),
  updateLibraryMoveFromPlanMove: (ctx) => updateLibraryMoveFromPlanMove(ctx, PLAN_MOVE, MOVE),
  forkPlanMoveToLibrary: (ctx) => forkPlanMoveToLibrary(ctx, { planMoveId: PLAN_MOVE } as never),
};

for (const [module, functions] of [
  ["plans.server", PLAN_FUNCTIONS],
  ["moves.server", MOVE_FUNCTIONS],
] as const) {
  describe(`${module}: the coach id carried on the context`, () => {
    for (const [name, run] of Object.entries(functions)) {
      it(`${name} does not read coach_profiles again, and uses the carried id`, async () => {
        // Every row belongs to the carried coach, so each function gets past
        // its ownership check; the coach row the fake would give a second
        // read has another id, so a second read would show in the arguments.
        const outcome = async (owner: string) => {
          const db = recorder(ownedBy(owner));
          const err = await quietly(() =>
            thrown(() => run({ userId: USER, supabase: db.client, coachId: COACH })),
          );
          return { db, signature: `${sent(db.calls).join(",")} -> ${String(err)}` };
        };
        const { db, signature } = await outcome(COACH);

        expect(coachReads(db.calls)).toHaveLength(0);
        const used = JSON.stringify(db.calls.map((c) => c.args));
        expect(used).not.toContain(SECOND_READ);
        // The carried id is used: it is in a filter or payload, or (where the
        // function compares a row's owner instead) the same rows owned by
        // another coach are treated differently.
        if (!used.includes(COACH)) {
          expect((await outcome(SECOND_READ)).signature).not.toBe(signature);
        }
        for (const [, value] of db.calls.flatMap((c) => c.eqs.filter(([k]) => k === "coach_id"))) {
          expect(value).toBe(COACH);
        }
      });

      it(`${name} reads coach_profiles first, by user id, when none is carried`, async () => {
        const db = recorder(profiles({ coach: true }));
        await quietly(() => thrown(() => run({ userId: USER, supabase: db.client })));

        expect(sent(db.calls)[0]).toBe("coach_profiles.select");
        expect(db.calls[0]!.eqs).toEqual([["user_id", USER]]);
        expect(coachReads(db.calls)).toHaveLength(1);
      });
    }
  });
}
