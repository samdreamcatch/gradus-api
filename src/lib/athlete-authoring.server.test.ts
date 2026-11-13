import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import { recordingClient, type Call } from "./recording-client.test-util";
import {
  addSeedMovesToAuthoredPlan,
  createAthletePlan,
  deleteAthletePlan,
  getAuthoredPlanDetail,
  listAthleteMoves,
  removeAuthoredPlanMove,
  reorderAuthoredPlanMoves,
  requireAuthor,
  setAthletePlanStatus,
  updateAthletePlan,
  updateAuthoredPlanMove,
} from "./athlete-authoring.server";

async function caught(run: () => Promise<unknown>): Promise<ApiError | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof ApiError ? err : null;
  }
}

const ATHLETE = { id: "ath-1", first_name: "Elsie", account_state: "active" };
const OWNED = { id: "plan-1", title: "Edges", notes: "Slow", status: "draft" };
const ctxOf = (client: unknown) => ({ userId: "user-1", supabase: client as never });
const has = (call: Call, method: string, column: string, value: unknown) =>
  call.filters.some((f) => f[0] === method && f[1] === column && f[2] === value);

/** Answers the athlete lookup and a plan lookup; `extra` handles anything else. */
function world(
  extra: (call: Call, kind: "one" | "many") => { data: unknown } | undefined = () => undefined,
  plan: Record<string, unknown> | null = OWNED,
  athlete: Record<string, unknown> | null = ATHLETE,
) {
  return recordingClient((call, kind) => {
    if (call.table === "athletes" && call.op === "select") return { data: athlete };
    if (call.table === "plans" && call.op === "select" && kind === "one") {
      // an ownership lookup only resolves when it names the owner and the source
      const owned = has(call, "eq", "athlete_id", "ath-1") && has(call, "eq", "source", "athlete");
      return { data: owned ? plan : null };
    }
    return extra(call, kind);
  });
}

describe("requireAuthor", () => {
  it("refuses an account that is not an athlete", async () => {
    const { client } = recordingClient(() => ({ data: null }));
    const err = await caught(() => requireAuthor(client, "user-1"));
    expect(err?.status).toBe(403);
    expect(err?.code).toBe("wrong_role");
  });

  it("refuses a paused athlete, but lets them read when asked", async () => {
    const paused = { ...ATHLETE, account_state: "paused" };
    const { client } = recordingClient(() => ({ data: paused }));
    const err = await caught(() => requireAuthor(client, "user-1"));
    expect(err?.status).toBe(403);
    expect(err?.code).toBe("paused");
    const ok = await requireAuthor(client, "user-1", { allowPaused: true });
    expect(ok).toEqual({ id: "ath-1", firstName: "Elsie" });
  });
});

describe("createAthletePlan", () => {
  it("inserts a draft owned by the athlete, with no coach and source 'athlete'", async () => {
    const { client, calls } = world((call) =>
      call.op === "insert" && call.table === "plans" ? { data: { id: "new-1" } } : undefined,
    );
    const res = await createAthletePlan(ctxOf(client), {});
    expect(res).toEqual({ id: "new-1" });
    const insert = calls.find((c) => c.table === "plans" && c.op === "insert")!;
    expect(insert.payload).toEqual({
      athlete_id: "ath-1",
      kind: "plan",
      source: "athlete",
      status: "draft",
      title: "Untitled plan",
      notes: "",
    });
    expect("coach_id" in (insert.payload as object)).toBe(false);
  });

  it("copies one of their own plans, moves unlinked, and never someone else's", async () => {
    const moves = [
      {
        position: 0,
        name: "Three turns",
        description: "d",
        cue: "c",
        why: "w",
        target_kind: "reps",
        target_value: 6,
      },
    ];
    const { client, calls } = world((call, kind) => {
      if (call.table === "plans" && call.op === "insert") return { data: { id: "copy-1" } };
      if (call.table === "plan_moves" && call.op === "select" && kind === "many") {
        return { data: moves };
      }
      return undefined;
    });
    await createAthletePlan(ctxOf(client), { fromPlanId: "plan-1" });
    const insert = calls.find((c) => c.table === "plans" && c.op === "insert")!;
    expect((insert.payload as { title: string }).title).toBe("Edges (copy)");
    expect((insert.payload as { notes: string }).notes).toBe("Slow");
    const pm = calls.find((c) => c.table === "plan_moves" && c.op === "insert")!;
    expect(pm.payload).toEqual([
      expect.objectContaining({
        plan_id: "copy-1",
        move_id: null,
        position: 0,
        name: "Three turns",
      }),
    ]);

    const foreign = world(undefined, null);
    const err = await caught(() => createAthletePlan(ctxOf(foreign.client), { fromPlanId: "x" }));
    expect(err?.status).toBe(404);
    expect(foreign.calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("refuses a paused athlete before any write", async () => {
    const { client, calls } = world(undefined, OWNED, { ...ATHLETE, account_state: "paused" });
    const err = await caught(() => createAthletePlan(ctxOf(client), {}));
    expect(err?.code).toBe("paused");
    expect(calls.some((c) => c.op !== "select")).toBe(false);
  });
});

describe("owner-scoped writes", () => {
  it("updateAthletePlan names the athlete and the source in the write itself", async () => {
    const { client, calls } = world();
    await updateAthletePlan(ctxOf(client), "plan-1", { title: "New", notes: "n" });
    const up = calls.find((c) => c.table === "plans" && c.op === "update")!;
    expect(up.payload).toEqual(expect.objectContaining({ title: "New", notes: "n" }));
    expect(has(up, "eq", "athlete_id", "ath-1")).toBe(true);
    expect(has(up, "eq", "source", "athlete")).toBe(true);
    expect(has(up, "eq", "id", "plan-1")).toBe(true);
  });

  it("every write 404s, writing nothing, when the plan is not theirs", async () => {
    const attempts: Array<(c: ReturnType<typeof world>) => Promise<unknown>> = [
      (w) => updateAthletePlan(ctxOf(w.client), "p", { title: "x" }),
      (w) => setAthletePlanStatus(ctxOf(w.client), "p", { status: "active" }),
      (w) => deleteAthletePlan(ctxOf(w.client), "p"),
      (w) => addSeedMovesToAuthoredPlan(ctxOf(w.client), "p", ["m"]),
      (w) => updateAuthoredPlanMove(ctxOf(w.client), "p", "pm", { name: "x" }),
      (w) => removeAuthoredPlanMove(ctxOf(w.client), "p", "pm"),
      (w) => reorderAuthoredPlanMoves(ctxOf(w.client), "p", ["a"]),
    ];
    for (const attempt of attempts) {
      const w = world(undefined, null);
      const err = await caught(() => attempt(w));
      expect(err?.status).toBe(404);
      expect(w.calls.some((c) => c.op !== "select")).toBe(false);
    }
  });

  it("setAthletePlanStatus has no cap and no conflict: it just sets the status", async () => {
    const { client, calls } = world();
    await setAthletePlanStatus(ctxOf(client), "plan-1", { status: "active" });
    const up = calls.find((c) => c.table === "plans" && c.op === "update")!;
    expect(up.payload).toEqual(expect.objectContaining({ status: "active" }));
    // one ownership lookup, then the write: no look at other active plans
    expect(calls.filter((c) => c.table === "plans" && c.op === "select")).toHaveLength(1);
  });
});

describe("deleteAthletePlan", () => {
  it("refuses an active plan (it is deleted first)", async () => {
    const { client, calls } = world(undefined, { ...OWNED, status: "active" });
    const err = await caught(() => deleteAthletePlan(ctxOf(client), "plan-1"));
    expect(err?.status).toBe(422);
    expect(err?.code).toBe("not_deletable");
    expect(calls.some((c) => c.op === "delete")).toBe(false);
  });

  it("deletes a benched or draft plan's moves and then the plan, scoped to the owner", async () => {
    for (const status of ["benched", "draft"]) {
      const { client, calls } = world(undefined, { ...OWNED, status });
      await deleteAthletePlan(ctxOf(client), "plan-1");
      const dels = calls.filter((c) => c.op === "delete");
      expect(dels.map((c) => c.table)).toEqual(["plan_moves", "plans"]);
      expect(has(dels[1], "eq", "athlete_id", "ath-1")).toBe(true);
      expect(has(dels[1], "eq", "source", "athlete")).toBe(true);
    }
  });
});

describe("addSeedMovesToAuthoredPlan", () => {
  const seed = (id: string, name: string) => ({
    id,
    sport: "figure_skating",
    category: "Edges",
    name,
    description: `${name} d`,
    cue: `${name} c`,
    why: `${name} w`,
    default_target_kind: "reps",
    default_target_value: 8,
  });

  it("copies curriculum moves as plain rows, in the order asked, after the last position", async () => {
    const { client, calls } = world((call, kind) => {
      if (call.table === "athlete_goals") return { data: [{ sport: "figure_skating" }] };
      if (call.table === "seed_moves") return { data: [seed("a", "Mohawk"), seed("b", "Choctaw")] };
      if (call.table === "plan_moves" && call.op === "select" && kind === "one") {
        return { data: { position: 4 } };
      }
      return undefined;
    });
    const res = await addSeedMovesToAuthoredPlan(ctxOf(client), "plan-1", ["b", "a", "zzz"]);
    expect(res).toEqual({ inserted: 2 });
    const ins = calls.find((c) => c.table === "plan_moves" && c.op === "insert")!;
    const rows = ins.payload as Array<{ name: string; position: number; move_id: unknown }>;
    expect(rows.map((r) => [r.name, r.position, r.move_id])).toEqual([
      ["Choctaw", 5, null],
      ["Mohawk", 6, null],
    ]);
    // the curriculum read is limited to the athlete's own sports
    const seeds = calls.find((c) => c.table === "seed_moves")!;
    expect(seeds.filters.some((f) => f[0] === "in" && f[1] === "sport")).toBe(true);
  });

  it("adds nothing when the athlete has no sport on their goals", async () => {
    const { client, calls } = world((call) =>
      call.table === "athlete_goals" ? { data: [] } : undefined,
    );
    const res = await addSeedMovesToAuthoredPlan(ctxOf(client), "plan-1", ["a"]);
    expect(res).toEqual({ inserted: 0 });
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });
});

describe("moves inside a plan", () => {
  it("updateAuthoredPlanMove 404s when the move is not in that plan", async () => {
    const { client, calls } = world((call) =>
      call.table === "plan_moves" ? { data: null } : undefined,
    );
    const err = await caught(() =>
      updateAuthoredPlanMove(ctxOf(client), "plan-1", "pm-9", { name: "x" }),
    );
    expect(err?.status).toBe(404);
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("updateAuthoredPlanMove pins the move to the plan in the write", async () => {
    const { client, calls } = world((call, kind) =>
      call.table === "plan_moves" && kind === "one" ? { data: { id: "pm-1" } } : undefined,
    );
    await updateAuthoredPlanMove(ctxOf(client), "plan-1", "pm-1", { targetValue: 12 });
    const up = calls.find((c) => c.table === "plan_moves" && c.op === "update")!;
    expect(up.payload).toEqual({ target_value: 12 });
    expect(has(up, "eq", "plan_id", "plan-1")).toBe(true);
  });

  it("removing a move that is already gone succeeds", async () => {
    const { client } = world();
    await expect(removeAuthoredPlanMove(ctxOf(client), "plan-1", "gone")).resolves.toEqual({
      ok: true,
    });
  });

  it("reorder writes each position for that plan only", async () => {
    const { client, calls } = world();
    await reorderAuthoredPlanMoves(ctxOf(client), "plan-1", ["x", "y", "z"]);
    const ups = calls.filter((c) => c.table === "plan_moves" && c.op === "update");
    expect(ups.map((c) => (c.payload as { position: number }).position)).toEqual([0, 1, 2]);
    expect(ups.every((c) => has(c, "eq", "plan_id", "plan-1"))).toBe(true);
  });
});

describe("listAthleteMoves", () => {
  it("is empty without a sport, and lists categories once each", async () => {
    const none = world((c) => (c.table === "athlete_goals" ? { data: [] } : undefined));
    expect(await listAthleteMoves(ctxOf(none.client))).toEqual({ moves: [], seedCategories: [] });

    const row = (id: string, category: string) => ({
      id,
      sport: "figure_skating",
      category,
      name: id,
      description: "",
      cue: "",
      why: "",
      default_target_kind: "mins",
      default_target_value: "5",
    });
    const some = world((c) =>
      c.table === "athlete_goals"
        ? { data: [{ sport: "figure_skating" }] }
        : c.table === "seed_moves"
          ? { data: [row("a", "Edges"), row("b", "Edges"), row("c", "Jumps")] }
          : undefined,
    );
    const lib = await listAthleteMoves(ctxOf(some.client));
    expect(lib.moves.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(lib.moves[0].defaultTargetValue).toBe(5);
    expect(lib.seedCategories).toEqual([
      { sport: "figure_skating", category: "Edges" },
      { sport: "figure_skating", category: "Jumps" },
    ]);
  });

  it("lets a paused athlete read the curriculum", async () => {
    const { client } = world(undefined, OWNED, { ...ATHLETE, account_state: "paused" });
    await expect(listAthleteMoves(ctxOf(client))).resolves.toEqual({
      moves: [],
      seedCategories: [],
    });
  });
});

describe("getAuthoredPlanDetail", () => {
  const detailCtx = (client: unknown) => ({
    userId: "user-1",
    supabase: client as never,
    admin: client as never,
  });

  it("serves the author their own plan in any status, as theirs", async () => {
    const { client } = world(
      (call, kind) => {
        if (call.table === "plan_moves" && kind === "many") {
          return {
            data: [
              {
                id: "pm-1",
                position: 0,
                name: "Three turns",
                description: "",
                cue: "Soft knees",
                why: "",
                target_kind: "reps",
                target_value: "6",
              },
            ],
          };
        }
        return undefined;
      },
      {
        id: "plan-1",
        title: "Edges",
        notes: "",
        status: "draft",
        updated_at: "2026-10-05T00:00:00Z",
        voice_transcript: "three turns six times",
        athlete_id: "ath-1",
      },
    );
    const d = await getAuthoredPlanDetail(detailCtx(client), "plan-1");
    expect(d).not.toBeNull();
    expect(d!.isOwner).toBe(true);
    expect(d!.viewerRole).toBe("athlete");
    expect(d!.status).toBe("draft");
    expect(d!.coach).toBeNull();
    expect(d!.source).toBe("athlete");
    expect(d!.authorFirstName).toBe("Elsie");
    expect(d!.voiceTranscript).toBe("three turns six times");
    expect(d!.moves[0]).toEqual(
      expect.objectContaining({ moveId: null, libraryMove: null, targetValue: 6 }),
    );
  });

  it("is null for a plan that is not theirs, so the role-aware loader falls through", async () => {
    const { client } = world(undefined, null);
    expect(await getAuthoredPlanDetail(detailCtx(client), "plan-9")).toBeNull();
  });

  it("is null for an account with no athlete row", async () => {
    const { client } = world(undefined, OWNED, null);
    expect(await getAuthoredPlanDetail(detailCtx(client), "plan-1")).toBeNull();
  });
});
