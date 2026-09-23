import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import { addPlanMoveToLibrary, updateLibraryMoveFromPlanMove } from "./moves.server";
import { resolvePlanViewerRole } from "./plan-detail.server";
import { listPlanSessionsQuery, submitSessionInput } from "./plan-sessions.server";
import {
  deletePlan,
  removePlanMove,
  savePlan,
  setPlanStatus,
  updatePlanMove,
  type CoachReasonInput,
} from "./plans.server";
import { assertAudioSize, audioFilename } from "./voice.server";

/** A chainable fake: `rows[table]` answers `maybeSingle`/`single`; `lists[table]` answers awaited selects. */
function fakeClient(rows: Record<string, unknown | null>, lists: Record<string, unknown[]> = {}) {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    for (const m of [
      "select",
      "eq",
      "neq",
      "in",
      "is",
      "lt",
      "lte",
      "gte",
      "order",
      "limit",
      "update",
      "delete",
      "insert",
      "upsert",
    ]) {
      self[m] = () => self;
    }
    self.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
    self.single = async () => ({ data: rows[table] ?? null, error: null });
    self.then = (resolve: (v: unknown) => void) =>
      resolve({ data: lists[table] ?? [], error: null });
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

describe("setPlanStatus", () => {
  it("activating past the per-athlete cap without a choice is 409 with the active plans", async () => {
    const supabase = fakeClient(
      { ...coach, plans: { id: "p1", athlete_id: "a1", title: "New", status: "benched" } },
      {
        plans: [
          { id: "p2", title: "Edges" },
          { id: "p3", title: "Spins" },
        ],
      },
    );
    const err = await caught(() =>
      setPlanStatus({ userId: "u", supabase }, "p1", { status: "active" }),
    );
    expect(err?.status).toBe(409);
    expect(err?.code).toBe("bench_choice_required");
    expect(
      (err?.details as { activePlans: { id: string }[] }).activePlans.map((p) => p.id),
    ).toEqual(["p2", "p3"]);
  });

  it("a replaceId that is not one of the active plans is refused", async () => {
    const supabase = fakeClient(
      { ...coach, plans: { id: "p1", athlete_id: "a1", title: "New", status: "benched" } },
      { plans: [{ id: "p2", title: "Edges" }] },
    );
    const err = await caught(() =>
      setPlanStatus({ userId: "u", supabase }, "p1", { status: "active", replaceId: "p9" }),
    );
    expect(err?.status).toBe(422);
    expect(err?.message).toBe("Selected plan is not active.");
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

  it("benching with a reason records every move of the plan, once, on the transition", async () => {
    const supabase = fakeClient(
      { ...coach, plans: { id: "p1", athlete_id: "a1", status: "active" } },
      {
        plan_moves: [
          { id: "pm1", move_id: "m1", name: "Axel" },
          { id: "pm2", move_id: null, name: "Spiral" },
        ],
      },
    );
    const r = recorder();
    await setPlanStatus(
      { userId: "u", supabase },
      "p1",
      { status: "benched", reason: "landed_it" },
      r.record,
    );
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0]).toMatchObject({
      athleteId: "a1",
      coachId: "coach-1",
      userId: "u",
      planId: "p1",
      reason: "landed_it",
    });
    expect(r.seen[0].moves).toEqual([
      { planMoveId: "pm1", moveId: "m1", name: "Axel" },
      { planMoveId: "pm2", moveId: null, name: "Spiral" },
    ]);
  });

  it("records nothing when the plan was already benched (a replay), skipped, or has no athlete", async () => {
    const r = recorder();
    const already = fakeClient({
      ...coach,
      plans: { id: "p1", athlete_id: "a1", status: "benched" },
    });
    await setPlanStatus(
      { userId: "u", supabase: already },
      "p1",
      { status: "benched", reason: "parking_it" },
      r.record,
    );
    const skipped = fakeClient({
      ...coach,
      plans: { id: "p1", athlete_id: "a1", status: "active" },
    });
    await setPlanStatus({ userId: "u", supabase: skipped }, "p1", { status: "benched" }, r.record);
    const shared = fakeClient({
      ...coach,
      plans: { id: "p1", athlete_id: null, status: "active" },
    });
    await setPlanStatus(
      { userId: "u", supabase: shared },
      "p1",
      { status: "benched", reason: "parking_it" },
      r.record,
    );
    const drafted = fakeClient({
      ...coach,
      plans: { id: "p1", athlete_id: "a1", status: "active" },
    });
    await setPlanStatus(
      { userId: "u", supabase: drafted },
      "p1",
      { status: "draft", reason: "parking_it" },
      r.record,
    );
    expect(r.seen).toHaveLength(0);
  });

  it("removing a move with a reason records that move for the plan's athlete", async () => {
    const supabase = fakeClient({
      ...coach,
      plan_moves: { plan_id: "p1", move_id: "m1", name: "Axel" },
      plans: { id: "p1", kind: "plan", status: "active", athlete_id: "a1" },
    });
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
        moves: [{ planMoveId: "pm1", moveId: "m1", name: "Axel" }],
      },
    ]);
  });

  it("removing a move that is already gone, or without a reason, records nothing", async () => {
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
    const skipped = fakeClient({
      ...coach,
      plan_moves: { plan_id: "p1", move_id: "m1", name: "Axel" },
      plans: { id: "p1", kind: "plan", status: "active", athlete_id: "a1" },
    });
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
