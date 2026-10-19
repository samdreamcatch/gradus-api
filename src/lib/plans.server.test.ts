import { describe, expect, it, mock } from "bun:test";
import { ApiError } from "./api/errors";
import { addPlanMoveToLibrary, updateLibraryMoveFromPlanMove } from "./moves.server";
import { resolvePlanViewerRole } from "./plan-detail.server";
import {
  listPlanSessionsQuery,
  submitPlanSession,
  submitSessionInput,
} from "./plan-sessions.server";
import {
  createPlan,
  deletePlan,
  removePlanMove,
  savePlan,
  setPlanStatus,
  updatePlan,
  updatePlanMove,
  type CoachReasonInput,
} from "./plans.server";
import { assertAudioSize, audioFilename } from "./voice.server";

/**
 * A chainable fake: `rows[table]` answers `maybeSingle`/`single`; `lists[table]` answers awaited selects.
 * `opts.writes` collects `table.op` for every insert/update/upsert/delete; `opts.errors["table.op"]`
 * makes the query that last called that write come back with that error.
 */
function fakeClient(
  rows: Record<string, unknown | null>,
  lists: Record<string, unknown[]> = {},
  opts: {
    writes?: string[];
    /** `table.column=value` for every `.eq(...)`. */
    filters?: string[];
    /** The object passed to every `.update(...)`. */
    payloads?: unknown[];
    errors?: Record<string, { code: string; message: string }>;
  } = {},
) {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    let lastWrite: string | null = null;
    for (const m of ["select", "neq", "in", "is", "lt", "lte", "gte", "order", "limit"]) {
      self[m] = () => self;
    }
    self.eq = (column: string, value: unknown) => {
      opts.filters?.push(`${table}.${column}=${String(value)}`);
      return self;
    };
    for (const m of ["update", "delete", "insert", "upsert"]) {
      self[m] = (payload?: unknown) => {
        lastWrite = m;
        opts.writes?.push(`${table}.${m}`);
        if (m === "update") opts.payloads?.push(payload);
        return self;
      };
    }
    const errorOf = () => (lastWrite ? (opts.errors?.[`${table}.${lastWrite}`] ?? null) : null);
    self.maybeSingle = async () => ({
      data: errorOf() ? null : (rows[table] ?? null),
      error: errorOf(),
    });
    self.single = async () => ({
      data: errorOf() ? null : (rows[table] ?? null),
      error: errorOf(),
    });
    self.then = (resolve: (v: unknown) => void) =>
      resolve({ data: errorOf() ? null : (lists[table] ?? []), error: errorOf() });
    return self;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => chain(table) } as any;
}

async function caught(run: () => Promise<unknown>): Promise<ApiError | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof ApiError ? err : null;
  }
}

const coach = { coach_profiles: { id: "coach-1" } };
/** The coach has athlete `a1` on their roster; any other athlete id reads as not rostered. */
const roster = { coach_athletes: { athlete_id: "a1" } };

describe("setPlanStatus", () => {
  // No cap on active plans per athlete (PRD decision #52).
  it("activating never reads the athlete's other plans and benches nothing", async () => {
    const writes: string[] = [];
    const payloads: unknown[] = [];
    const supabase = fakeClient(
      {
        ...coach,
        ...roster,
        plans: { id: "p1", athlete_id: "a1", title: "New", status: "benched" },
      },
      {},
      { writes, payloads },
    );
    const seen: CoachReasonInput[] = [];
    await setPlanStatus({ userId: "u", supabase }, "p1", { status: "active" }, async (input) => {
      seen.push(input);
    });
    // Only this plan is written; nothing else is benched and no "why" is recorded.
    expect(writes).toEqual(["plans.update"]);
    expect(payloads).toEqual([{ status: "active" }]);
    expect(seen).toHaveLength(0);
  });

  it("a replaceId (older iOS builds) benches that plan, then activates this one", async () => {
    const payloads: unknown[] = [];
    const filters: string[] = [];
    const supabase = fakeClient(
      {
        ...coach,
        ...roster,
        plans: { id: "p1", athlete_id: "a1", title: "New", status: "benched" },
      },
      {
        plans: [
          { id: "p2", title: "Edges", athlete_id: "a1" },
          { id: "p3", title: "Spins", athlete_id: "a1" },
        ],
      },
      { payloads, filters },
    );
    await setPlanStatus({ userId: "u", supabase }, "p1", { status: "active", replaceId: "p3" });
    expect(payloads).toEqual([{ status: "benched" }, { status: "active" }]);
    // The bench only matches another of this athlete's active plans from this coach.
    for (const f of [
      "plans.id=p3",
      "plans.coach_id=coach-1",
      "plans.athlete_id=a1",
      "plans.kind=plan",
      "plans.status=active",
    ]) {
      expect(filters).toContain(f);
    }
  });

  it("a stale replaceId (already benched, or another athlete's) benches nothing and still activates", async () => {
    // The conditional bench matches no row; the activation is not refused, so an
    // outbox replay after a lost response is not parked as a conflict.
    const payloads: unknown[] = [];
    const seen: CoachReasonInput[] = [];
    const supabase = fakeClient(
      {
        ...coach,
        ...roster,
        plans: { id: "p1", athlete_id: "a1", title: "New", status: "benched" },
      },
      { plans: [] },
      { payloads },
    );
    await setPlanStatus(
      { userId: "u", supabase },
      "p1",
      { status: "active", replaceId: "p9", reason: "landed_it" },
      async (input) => void seen.push(input),
    );
    expect(payloads).toEqual([{ status: "benched" }, { status: "active" }]);
    expect(seen).toHaveLength(0);
  });

  it("a replaceId naming this plan is ignored", async () => {
    const payloads: unknown[] = [];
    const supabase = fakeClient(
      {
        ...coach,
        ...roster,
        plans: { id: "p1", athlete_id: "a1", title: "New", status: "benched" },
      },
      {},
      { payloads },
    );
    await setPlanStatus({ userId: "u", supabase }, "p1", { status: "active", replaceId: "p1" });
    expect(payloads).toEqual([{ status: "active" }]);
  });

  it("replaying an activation that already landed rewrites only this plan", async () => {
    const writes: string[] = [];
    const payloads: unknown[] = [];
    const supabase = fakeClient(
      {
        ...coach,
        ...roster,
        plans: { id: "p1", athlete_id: "a1", title: "New", status: "active" },
      },
      { plans: [{ id: "p2", title: "Edges" }] },
      { writes, payloads },
    );
    await setPlanStatus({ userId: "u", supabase }, "p1", { status: "active" });
    expect(writes).toEqual(["plans.update"]);
    expect(payloads).toEqual([{ status: "active" }]);
  });

  it("a parent account is refused before any plan is read", async () => {
    const supabase = fakeClient({ parent_profiles: { id: "parent-1" } });
    const err = await caught(() =>
      setPlanStatus({ userId: "u", supabase }, "p1", { status: "benched" }),
    );
    expect(err?.status).toBe(403);
    expect(err?.code).toBe("wrong_role");
  });
});

describe('coach "why" answers (L1)', () => {
  const recorder = () => {
    const seen: CoachReasonInput[] = [];
    return { seen, record: async (input: CoachReasonInput) => void seen.push(input) };
  };

  it("benching with a reason records once, when the plan actually changed to benched", async () => {
    // The conditional update returns the row it changed.
    const supabase = fakeClient({ ...coach }, { plans: [{ id: "p1", athlete_id: "a1" }] });
    const r = recorder();
    await setPlanStatus(
      { userId: "u", supabase },
      "p1",
      { status: "benched", reason: "landed_it" },
      r.record,
    );
    expect(r.seen).toEqual([
      { athleteId: "a1", coachId: "coach-1", userId: "u", planId: "p1", reason: "landed_it" },
    ]);
  });

  it("making room on activate records the reason against the plan it benches", async () => {
    // `lists.plans` answers the conditional bench update, so the benched row
    // carries the athlete.
    const supabase = fakeClient(
      {
        ...coach,
        ...roster,
        plans: { id: "p1", athlete_id: "a1", title: "New", status: "benched" },
      },
      { plans: [{ id: "p2", title: "Edges", athlete_id: "a1" }] },
    );
    const r = recorder();
    await setPlanStatus(
      { userId: "u", supabase },
      "p1",
      { status: "active", replaceId: "p2", reason: "changed_direction" },
      r.record,
    );
    expect(r.seen).toEqual([
      {
        athleteId: "a1",
        coachId: "coach-1",
        userId: "u",
        planId: "p2",
        reason: "changed_direction",
      },
    ]);
  });

  it("making room without a reason records nothing", async () => {
    const r = recorder();
    const skipped = fakeClient(
      {
        ...coach,
        ...roster,
        plans: { id: "p1", athlete_id: "a1", title: "New", status: "benched" },
      },
      { plans: [{ id: "p2", title: "Edges", athlete_id: "a1" }] },
    );
    await setPlanStatus(
      { userId: "u", supabase: skipped },
      "p1",
      { status: "active", replaceId: "p2" },
      r.record,
    );
    expect(r.seen).toHaveLength(0);
  });

  it("records nothing when no row changed (a replay or racing retry), when skipped, or with no athlete", async () => {
    const r = recorder();
    const unchanged = fakeClient({ ...coach }, { plans: [] });
    await setPlanStatus(
      { userId: "u", supabase: unchanged },
      "p1",
      { status: "benched", reason: "parking_it" },
      r.record,
    );
    const skipped = fakeClient({ ...coach }, { plans: [{ id: "p1", athlete_id: "a1" }] });
    await setPlanStatus({ userId: "u", supabase: skipped }, "p1", { status: "benched" }, r.record);
    const shared = fakeClient({ ...coach }, { plans: [{ id: "p1", athlete_id: null }] });
    await setPlanStatus(
      { userId: "u", supabase: shared },
      "p1",
      { status: "benched", reason: "parking_it" },
      r.record,
    );
    const drafted = fakeClient({ ...coach }, { plans: [{ id: "p1", athlete_id: "a1" }] });
    await setPlanStatus(
      { userId: "u", supabase: drafted },
      "p1",
      { status: "draft", reason: "parking_it" },
      r.record,
    );
    expect(r.seen).toHaveLength(0);
  });

  const owned = {
    ...coach,
    plan_moves: { plan_id: "p1", move_id: "m1", name: "Axel" },
    plans: { id: "p1", kind: "plan", status: "active", athlete_id: "a1" },
  };

  it("removing a move with a reason records that move for the plan's athlete", async () => {
    const supabase = fakeClient(owned, { plan_moves: [{ id: "pm1" }] });
    const r = recorder();
    await removePlanMove(
      { userId: "u", supabase },
      "pm1",
      "p1",
      new Date(),
      "changed_direction",
      r.record,
    );
    expect(r.seen).toEqual([
      {
        athleteId: "a1",
        coachId: "coach-1",
        userId: "u",
        planId: "p1",
        reason: "changed_direction",
        moves: [{ planMoveId: "pm1", moveId: "m1", name: "Axel", startedAt: null }],
      },
    ]);
  });

  it("records nothing when the move is gone, another request deleted it first, or the coach skipped", async () => {
    const r = recorder();
    const gone = fakeClient({ ...coach });
    await removePlanMove(
      { userId: "u", supabase: gone },
      "pm1",
      "p1",
      new Date(),
      "landed_it",
      r.record,
    );
    const raced = fakeClient(owned, { plan_moves: [] });
    await removePlanMove(
      { userId: "u", supabase: raced },
      "pm1",
      "p1",
      new Date(),
      "landed_it",
      r.record,
    );
    const skipped = fakeClient(owned, { plan_moves: [{ id: "pm1" }] });
    await removePlanMove(
      { userId: "u", supabase: skipped },
      "pm1",
      "p1",
      new Date(),
      undefined,
      r.record,
    );
    expect(r.seen).toHaveLength(0);
  });
});

describe("deletePlan", () => {
  it("only templates and drafts can be deleted", async () => {
    const active = fakeClient({
      ...coach,
      plans: { id: "p1", kind: "plan", status: "active", athlete_id: "a1" },
    });
    const err = await caught(() => deletePlan({ userId: "u", supabase: active }, "p1"));
    expect(err?.status).toBe(422);
    expect(err?.code).toBe("not_deletable");

    const draft = fakeClient({
      ...coach,
      plans: { id: "p1", kind: "plan", status: "draft", athlete_id: null },
    });
    await expect(deletePlan({ userId: "u", supabase: draft }, "p1")).resolves.toEqual({ ok: true });
  });
});

describe("savePlan", () => {
  it("refuses to replace another coach's plan", async () => {
    // plans lookups answer null: the row is not owned by coach-1.
    const supabase = fakeClient({ ...coach, plans: null });
    const err = await caught(() =>
      savePlan(
        { userId: "u", supabase },
        { id: "p-other", title: "T", notes: "", kind: "plan", athleteId: "a1", moves: [] },
      ),
    );
    expect(err?.status).toBe(404);
    expect(err?.message).toBe("Plan not found");
  });
});

describe("plan writes stay on the coach's roster", () => {
  // `fakeClient` answers any coach_athletes read with the `roster` row (or null without it), so
  // "on the roster" and "not on the roster" differ only by whether `...roster` is in the rows.
  const forbiddenRoster = (err: ApiError | null) => {
    expect(err?.status).toBe(403);
    expect(err?.code).toBe("forbidden");
    expect(err?.message).toBe("Athlete is not on your roster");
  };
  const rlsRefusal = {
    code: "42501",
    message: 'new row violates row-level security policy for table "plans"',
  };
  const owned = {
    id: "p1",
    kind: "plan",
    status: "draft",
    athlete_id: "a1",
    title: "T",
    notes: "",
  };
  const input = (athleteId: string | null, kind: "plan" | "template" = "plan") => ({
    title: "T",
    notes: "",
    kind,
    athleteId,
    moves: [],
  });

  describe("savePlan", () => {
    it("a new plan for an athlete not on the roster is 403 and writes nothing", async () => {
      const writes: string[] = [];
      const supabase = fakeClient({ ...coach, plans: { id: "new-1" } }, {}, { writes });
      const err = await caught(() => savePlan({ userId: "u", supabase }, input("a-stranger")));
      forbiddenRoster(err);
      expect(writes).toEqual([]);
    });

    it("re-pointing the coach's own plan at an athlete not on the roster is 403 and writes nothing", async () => {
      const writes: string[] = [];
      const supabase = fakeClient({ ...coach, plans: owned }, {}, { writes });
      const err = await caught(() =>
        savePlan({ userId: "u", supabase }, { ...input("a-stranger"), id: "p1" }),
      );
      forbiddenRoster(err);
      expect(writes).toEqual([]);
    });

    it("a plan for a rostered athlete is saved", async () => {
      const writes: string[] = [];
      const supabase = fakeClient({ ...coach, ...roster, plans: { id: "new-1" } }, {}, { writes });
      await expect(savePlan({ userId: "u", supabase }, input("a1"))).resolves.toEqual({
        id: "new-1",
      });
      expect(writes).toEqual(["plans.insert", "plan_moves.delete"]);
    });

    it("a template needs no roster row, whatever athleteId the client sent", async () => {
      const writes: string[] = [];
      const supabase = fakeClient({ ...coach, plans: { id: "t1" } }, {}, { writes });
      await expect(
        savePlan({ userId: "u", supabase }, input("a-stranger", "template")),
      ).resolves.toEqual({ id: "t1" });
      expect(writes).toContain("plans.insert");
    });

    it("the database's refusal (the roster policy, if it ever disagrees) is the same 403", async () => {
      const supabase = fakeClient(
        { ...coach, ...roster, plans: { id: "new-1" } },
        {},
        { errors: { "plans.insert": rlsRefusal } },
      );
      forbiddenRoster(await caught(() => savePlan({ userId: "u", supabase }, input("a1"))));
    });
  });

  describe("createPlan", () => {
    it("a plan for an athlete not on the roster is 403 and writes nothing", async () => {
      const writes: string[] = [];
      const supabase = fakeClient({ ...coach, plans: { id: "new-1" } }, {}, { writes });
      const err = await caught(() =>
        createPlan({ userId: "u", supabase }, { kind: "plan", athleteId: "a-stranger" }),
      );
      forbiddenRoster(err);
      expect(writes).toEqual([]);
    });

    it("a plan for a rostered athlete, and a template, are created", async () => {
      const supabase = fakeClient({ ...coach, ...roster, plans: { id: "new-1" } });
      await expect(
        createPlan({ userId: "u", supabase }, { kind: "plan", athleteId: "a1" }),
      ).resolves.toEqual({ id: "new-1" });
      const noRoster = fakeClient({ ...coach, plans: { id: "t1" } });
      await expect(
        createPlan(
          { userId: "u", supabase: noRoster },
          { kind: "template", athleteId: "a-stranger" },
        ),
      ).resolves.toEqual({ id: "t1" });
    });
  });

  describe("updatePlan", () => {
    it("assigning a draft to an athlete not on the roster is 403 and writes nothing", async () => {
      const writes: string[] = [];
      const supabase = fakeClient({ ...coach, plans: owned }, {}, { writes });
      const err = await caught(() =>
        updatePlan({ userId: "u", supabase }, "p1", { athleteId: "a-stranger" }),
      );
      forbiddenRoster(err);
      expect(writes).toEqual([]);
    });

    it("reassigning an active plan (the fork) to an athlete not on the roster is 403 and forks nothing", async () => {
      const writes: string[] = [];
      const supabase = fakeClient(
        { ...coach, plans: { ...owned, status: "active", athlete_id: "a2" } },
        {},
        { writes },
      );
      const err = await caught(() =>
        updatePlan({ userId: "u", supabase }, "p1", { athleteId: "a-stranger" }),
      );
      forbiddenRoster(err);
      expect(writes).toEqual([]);
    });

    it("reassigning an active plan to a rostered athlete forks it", async () => {
      const writes: string[] = [];
      const supabase = fakeClient(
        { ...coach, ...roster, plans: { ...owned, status: "active", athlete_id: "a2" } },
        {},
        { writes },
      );
      const res = await updatePlan({ userId: "u", supabase }, "p1", { athleteId: "a1" });
      expect(res.ok).toBe(true);
      expect(res.forkedId).toBeDefined();
      expect(writes).toContain("plans.insert");
    });

    it("editing a plan whose athlete has left the roster is 403, as the database would refuse it", async () => {
      const writes: string[] = [];
      const supabase = fakeClient({ ...coach, plans: owned }, {}, { writes });
      const err = await caught(() =>
        updatePlan({ userId: "u", supabase }, "p1", { title: "New title" }),
      );
      forbiddenRoster(err);
      expect(writes).toEqual([]);
    });

    it("an active plan whose athlete has left can still be converted to a template (athlete cleared, back to draft)", async () => {
      const writes: string[] = [];
      const supabase = fakeClient(
        { ...coach, plans: { ...owned, status: "active" } },
        {},
        { writes },
      );
      await expect(
        updatePlan({ userId: "u", supabase }, "p1", { kind: "template" }),
      ).resolves.toEqual({ ok: true });
      expect(writes).toEqual(["plans.update"]);
    });

    it("detaching a plan (athleteId null) and editing a rostered plan both work", async () => {
      const detachWrites: string[] = [];
      const detach = fakeClient({ ...coach, plans: owned }, {}, { writes: detachWrites });
      await expect(
        updatePlan({ userId: "u", supabase: detach }, "p1", { athleteId: null }),
      ).resolves.toEqual({ ok: true });
      expect(detachWrites).toEqual(["plans.update"]);

      const edit = fakeClient({ ...coach, ...roster, plans: owned });
      await expect(
        updatePlan({ userId: "u", supabase: edit }, "p1", { title: "New title" }),
      ).resolves.toEqual({ ok: true });
    });
  });

  describe("setPlanStatus", () => {
    it("activating a plan whose athlete is not on the roster is 403 before anything is written or sent", async () => {
      const writes: string[] = [];
      const supabase = fakeClient(
        { ...coach, plans: { id: "p1", athlete_id: "a-stranger", title: "T", status: "draft" } },
        { plans: [] },
        { writes },
      );
      const err = await caught(() =>
        setPlanStatus({ userId: "u", supabase }, "p1", { status: "active" }),
      );
      forbiddenRoster(err);
      expect(writes).toEqual([]);
    });

    describe("a plan whose athlete has left the roster", () => {
      // The coach may take it down (active to benched or draft) and nothing else.
      const gone = { ...coach, plans: { id: "p1", athlete_id: "a-gone", status: "active" } };
      const neverAdmin = async () => {
        throw new Error("the admin client must not be used here");
      };
      const adminSpy = () => {
        const writes: string[] = [];
        const filters: string[] = [];
        const payloads: unknown[] = [];
        const client = fakeClient({}, {}, { writes, filters, payloads });
        return { writes, filters, payloads, load: async () => client };
      };

      for (const status of ["benched", "draft"] as const) {
        it(`active to ${status} is allowed, written by the server, scoped to this coach's active plan`, async () => {
          const userWrites: string[] = [];
          const supabase = fakeClient(gone, {}, { writes: userWrites });
          const admin = adminSpy();
          await expect(
            setPlanStatus({ userId: "u", supabase }, "p1", { status }, undefined, admin.load),
          ).resolves.toEqual({ ok: true });
          expect(userWrites).toEqual([]);
          expect(admin.writes).toEqual(["plans.update"]);
          expect(admin.payloads).toEqual([{ status }]);
          expect(admin.filters).toEqual([
            "plans.id=p1",
            "plans.coach_id=coach-1",
            "plans.status=active",
          ]);
        });
      }

      it("benching it records no 'why' (the coach no longer coaches the athlete)", async () => {
        const seen: CoachReasonInput[] = [];
        const supabase = fakeClient(gone);
        const admin = adminSpy();
        await setPlanStatus(
          { userId: "u", supabase },
          "p1",
          { status: "benched", reason: "parking_it" },
          async (input) => void seen.push(input),
          admin.load,
        );
        expect(seen).toHaveLength(0);
        expect(admin.writes).toEqual(["plans.update"]);
      });

      for (const [from, to] of [
        ["benched", "draft"],
        ["draft", "benched"],
      ] as const) {
        it(`${from} to ${to} is refused with 403, and the server writes nothing`, async () => {
          const supabase = fakeClient({
            ...coach,
            plans: { id: "p1", athlete_id: "a-gone", status: from },
          });
          const err = await caught(() =>
            setPlanStatus({ userId: "u", supabase }, "p1", { status: to }, undefined, neverAdmin),
          );
          forbiddenRoster(err);
        });
      }

      it("a replay of a demotion that already happened changes nothing and still succeeds", async () => {
        const supabase = fakeClient({
          ...coach,
          plans: { id: "p1", athlete_id: "a-gone", status: "benched" },
        });
        await expect(
          setPlanStatus(
            { userId: "u", supabase },
            "p1",
            { status: "benched" },
            undefined,
            neverAdmin,
          ),
        ).resolves.toEqual({ ok: true });
      });

      it("a rostered athlete's plan is benched through the coach's own client, never the server's", async () => {
        const userWrites: string[] = [];
        const supabase = fakeClient({ ...gone, ...roster }, {}, { writes: userWrites });
        await expect(
          setPlanStatus(
            { userId: "u", supabase },
            "p1",
            { status: "benched" },
            undefined,
            neverAdmin,
          ),
        ).resolves.toEqual({ ok: true });
        expect(userWrites).toEqual(["plans.update"]);
      });
    });

    it("benching or drafting a plan the database refuses is the same 403, not a generic error", async () => {
      const refused = { errors: { "plans.update": rlsRefusal } };
      const withReason = fakeClient({ ...coach }, { plans: [] }, refused);
      forbiddenRoster(
        await caught(() =>
          setPlanStatus({ userId: "u", supabase: withReason }, "p1", {
            status: "benched",
            reason: "parking_it",
          }),
        ),
      );
      const plain = fakeClient({ ...coach }, { plans: [] }, refused);
      forbiddenRoster(
        await caught(() =>
          setPlanStatus({ userId: "u", supabase: plain }, "p1", { status: "draft" }),
        ),
      );
    });

    it("any other database error stays the generic message", async () => {
      const supabase = fakeClient(
        { ...coach },
        { plans: [] },
        { errors: { "plans.update": { code: "23514", message: "check constraint" } } },
      );
      await expect(
        setPlanStatus({ userId: "u", supabase }, "p1", { status: "draft" }),
      ).rejects.toThrow("Something went wrong. Please try again.");
    });
  });
});

describe("updatePlanMove", () => {
  it("the path's plan must own the move", async () => {
    const supabase = fakeClient({ ...coach, plan_moves: { plan_id: "p1" } });
    const err = await caught(() =>
      updatePlanMove({ userId: "u", supabase }, "pm1", { name: "Waltz jump" }, "p2"),
    );
    expect(err?.status).toBe(404);
    expect(err?.message).toBe("Plan move not found");
  });
});

describe("library links", () => {
  it("another coach's plan move is not authorized", async () => {
    const supabase = fakeClient({
      ...coach,
      plan_moves: {
        id: "pm1",
        move_id: null,
        name: "Loop",
        cue: "c",
        why: "w",
        target_kind: "reps",
        target_value: 5,
        plans: { coach_id: "coach-2" },
      },
    });
    const err = await caught(() =>
      addPlanMoveToLibrary(
        { userId: "u", supabase },
        { planMoveId: "pm1", sport: "figure_skating", category: "Jumps" },
      ),
    );
    expect(err?.status).toBe(403);
    expect(err?.message).toBe("Not authorized");
  });

  it("updating a library move from a plan move linked elsewhere is refused", async () => {
    const supabase = fakeClient({
      ...coach,
      plan_moves: {
        id: "pm1",
        move_id: "m1",
        name: "Loop",
        cue: "c",
        why: "w",
        target_kind: "reps",
        target_value: 5,
        plans: { coach_id: "coach-1" },
      },
    });
    const err = await caught(() =>
      updateLibraryMoveFromPlanMove({ userId: "u", supabase }, "pm1", "m2"),
    );
    expect(err?.status).toBe(422);
  });
});

describe("resolvePlanViewerRole", () => {
  it("prefers coach, then parent, then athlete, and defaults to coach", async () => {
    expect(await resolvePlanViewerRole(fakeClient({ ...coach }), "u")).toBe("coach");
    expect(await resolvePlanViewerRole(fakeClient({ parent_profiles: { id: "p" } }), "u")).toBe(
      "parent",
    );
    expect(await resolvePlanViewerRole(fakeClient({ athletes: { id: "a" } }), "u")).toBe("athlete");
    expect(await resolvePlanViewerRole(fakeClient({}), "u")).toBe("coach");
  });
});

describe("session inputs", () => {
  it("coerce the page size and validate the cursor", () => {
    expect(listPlanSessionsQuery.parse({ limit: "50" }).limit).toBe(50);
    expect(listPlanSessionsQuery.parse({}).limit).toBe(100);
    expect(listPlanSessionsQuery.safeParse({ before: "yesterday" }).success).toBe(false);
    expect(listPlanSessionsQuery.safeParse({ before: "2026-09-06T12:00:00Z" }).success).toBe(true);
    expect(submitSessionInput.parse({ stateIndex: 3 })).toEqual({
      stateIndex: 3,
      note: "",
      durationSeconds: 0,
    });
    expect(submitSessionInput.safeParse({ stateIndex: 5 }).success).toBe(false);
  });
});

describe("voice uploads", () => {
  it("name the file by its container so the transcription service reads it", () => {
    expect(audioFilename(new Blob([], { type: "audio/mp4" }))).toBe("voice.m4a");
    expect(audioFilename(new Blob([], { type: "audio/webm;codecs=opus" }))).toBe("voice.webm");
    expect(audioFilename(new Blob([]))).toBe("voice.webm");
    expect(audioFilename(new File([], "voice.m4a", { type: "application/octet-stream" }))).toBe(
      "voice.m4a",
    );
  });

  it("refuse recordings over the 18 MB cap with 413", () => {
    const err = (() => {
      try {
        assertAudioSize({ size: 19 * 1024 * 1024 } as Blob);
        return null;
      } catch (e) {
        return e instanceof ApiError ? e : null;
      }
    })();
    expect(err?.status).toBe(413);
    expect(err?.code).toBe("payload_too_large");
  });
});

describe("feedback on each move or the whole plan", () => {
  const owned = {
    coach_id: "coach-1",
    kind: "plan",
    status: "draft",
    athlete_id: "a1",
    title: "T",
    notes: "",
    feedback_scope: "plan",
  };
  const m1 = "11111111-1111-4111-8111-111111111111";
  const m2 = "22222222-2222-4222-8222-222222222222";

  it("a check-in rates the session, or at least one move, never the same move twice", () => {
    expect(submitSessionInput.safeParse({}).success).toBe(false);
    expect(submitSessionInput.safeParse({ moveRatings: [] }).success).toBe(false);
    expect(
      submitSessionInput.safeParse({ moveRatings: [{ planMoveId: m1, stateIndex: 2 }] }).success,
    ).toBe(true);
    expect(
      submitSessionInput.safeParse({
        moveRatings: [
          { planMoveId: m1, stateIndex: 2 },
          { planMoveId: m1, stateIndex: 3 },
        ],
      }).success,
    ).toBe(false);
    expect(
      submitSessionInput.safeParse({ moveRatings: [{ planMoveId: m1, stateIndex: 5 }] }).success,
    ).toBe(false);
    expect(
      submitSessionInput.safeParse({ moveRatings: [{ planMoveId: "nope", stateIndex: 1 }] })
        .success,
    ).toBe(false);
  });

  it("the coach's choice is saved with the plan", async () => {
    const payloads: unknown[] = [];
    const supabase = fakeClient({ ...coach, ...roster, plans: owned }, {}, { payloads });
    await expect(
      updatePlan({ userId: "u", supabase }, "p1", { feedbackScope: "moves" }),
    ).resolves.toEqual({ ok: true });
    expect(payloads[0]).toMatchObject({ feedback_scope: "moves" });
  });

  it("a plan forked to another athlete keeps its feedback choice", async () => {
    const inserts: unknown[] = [];
    const supabase = fakeClient({
      ...coach,
      ...roster,
      plans: { ...owned, status: "active", athlete_id: "a2", feedback_scope: "moves", id: "p2" },
    });
    const from = supabase.from;
    supabase.from = (table: string) => {
      const q = from(table);
      const insert = q.insert;
      q.insert = (payload: unknown) => {
        if (table === "plans") inserts.push(payload);
        return insert(payload);
      };
      return q;
    };
    const res = await updatePlan({ userId: "u", supabase }, "p1", { athleteId: "a1" });
    expect(res.forkedId).toBeDefined();
    expect(inserts[0]).toMatchObject({ feedback_scope: "moves" });
  });

  /** Just enough of a client for submitPlanSession: profile lookups and the rpc. */
  function submitClient(opts: { parent?: boolean; rpcError?: { code: string; message: string } }) {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const rows: Record<string, unknown> = {
      parent_profiles: opts.parent ? { id: "pp1" } : null,
      athletes: { id: "a1" },
      plans: { id: "p1", athlete_id: "a1" },
    };
    const chain = (table: string) => {
      const self: Record<string, unknown> = {};
      self.select = () => self;
      self.eq = () => self;
      self.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
      return self;
    };
    const client = {
      from: chain,
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return { data: "s1", error: opts.rpcError ?? null };
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { client: client as any, calls };
  }

  it("an each-move check-in sends the ratings and lets the server work out the session's rating", async () => {
    const { client, calls } = submitClient({});
    const input = submitSessionInput.parse({
      stateIndex: 4,
      moveRatings: [
        { planMoveId: m1, stateIndex: 1 },
        { planMoveId: m2, stateIndex: 3 },
      ],
    });
    await expect(
      submitPlanSession({ userId: "u", supabase: client }, "p1", input),
    ).resolves.toEqual({
      ok: true,
      loggedAs: "athlete",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("log_plan_session");
    expect(calls[0].args).toMatchObject({
      _plan_id: "p1",
      _athlete_id: "a1",
      _parent_id: null,
      _state_index: null,
    });
    expect(calls[0].args._move_ratings).toEqual(input.moveRatings);
  });

  it("a whole-plan check-in from a parent sends its one rating", async () => {
    const { client, calls } = submitClient({ parent: true });
    await submitPlanSession(
      { userId: "u", supabase: client },
      "p1",
      submitSessionInput.parse({ stateIndex: 2 }),
    );
    expect(calls[0].args).toMatchObject({ _parent_id: "pp1", _state_index: 2, _move_ratings: [] });
  });

  it("a rated move that isn't on the plan is a 422", async () => {
    const { client } = submitClient({
      rpcError: { code: "22023", message: "A rated move is not on this plan" },
    });
    const err = await caught(() =>
      submitPlanSession(
        { userId: "u", supabase: client },
        "p1",
        submitSessionInput.parse({ moveRatings: [{ planMoveId: m1, stateIndex: 1 }] }),
      ),
    );
    expect(err?.status).toBe(422);
  });
});

describe("setPlanStatus and the guardian on file (decision #56)", () => {
  it("going live sends the existing guardian-activity copy once, on the transition only", async () => {
    // A coach cannot message a minor whose parent hasn't joined, so this
    // email is what tells the parent a plan was shared. Nothing new is sent:
    // the "Guardian message copy" template already in Admin → Emails.
    const real = await import("./guardian.server");
    const mirrored: unknown[] = [];
    mock.module("./guardian.server", () => ({
      ...real,
      mirrorGuardianActivity: async (p: unknown) => {
        mirrored.push(p);
      },
    }));
    try {
      const draft = fakeClient({
        ...coach,
        ...roster,
        plans: { id: "p1", athlete_id: "a1", title: "Loop week", status: "draft" },
      });
      await setPlanStatus(
        { userId: "u", supabase: draft },
        "p1",
        { status: "active" },
        async () => {},
      );
      expect(mirrored).toEqual([
        {
          athleteId: "a1",
          senderRole: "coach",
          coachId: "coach-1",
          body: "Assigned a new plan: Loop week",
        },
      ]);

      // A replay of an activation that already landed sends nothing more.
      const live = fakeClient({
        ...coach,
        ...roster,
        plans: { id: "p1", athlete_id: "a1", title: "Loop week", status: "active" },
      });
      await setPlanStatus(
        { userId: "u", supabase: live },
        "p1",
        { status: "active" },
        async () => {},
      );
      expect(mirrored).toHaveLength(1);
    } finally {
      mock.module("./guardian.server", () => real);
    }
  });
});
