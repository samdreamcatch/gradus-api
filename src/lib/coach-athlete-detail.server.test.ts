import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import {
  getCoachAthleteDetail,
  getOtherCoachPlanForMessage,
  summarySessionLine,
} from "./coach-athlete-detail.server";
import { STATE_LABELS } from "./session-states";

/**
 * The coach's AI summary must describe a session with the same flow-state
 * words the athlete or parent chose. Until 2026-09-20 this module carried a
 * second, mastery-flavored scale for the same `state_index`, so "Steady"
 * reached the coach as "Comfortable" and "Locked in" as "Flowing".
 */
describe("summarySessionLine", () => {
  const base = {
    logged_at: "2026-09-18T15:00:00.000Z",
    duration_seconds: 1500,
    parent_id: null,
    note: "",
    plan_id: null,
  };

  it("uses the canonical flow-state labels for every index", () => {
    const expected = ["Frustrated", "Pushing", "Steady", "Locked in", "Flowing"];
    expect([...STATE_LABELS]).toEqual(expected);
    for (let i = 0; i < 5; i++) {
      const line = summarySessionLine({ ...base, state_index: i }, new Map());
      expect(line).toContain(`"${expected[i]}"`);
      expect(line).not.toMatch(/Just learning|Getting it|Comfortable|Mastered/);
    }
  });

  it("clamps out-of-range and missing indexes instead of throwing", () => {
    expect(summarySessionLine({ ...base, state_index: null }, new Map())).toContain('"Frustrated"');
    expect(summarySessionLine({ ...base, state_index: 9 }, new Map())).toContain('"Flowing"');
  });

  it("keeps the rest of the line: date, attribution, minutes, plan tag, wrapped note", () => {
    const planById = new Map([["p1", { title: "Axel prep", status: "active" }]]);
    const line = summarySessionLine(
      { ...base, state_index: 2, parent_id: "parent", plan_id: "p1", note: "felt good" },
      planById,
    );
    expect(line).toContain('2026-09-18 (parent-logged, 25m, "Steady" plan="Axel prep" (active))');
    expect(line).toContain("felt good");
  });
});

/* -------------------------------------------------------------------------- */
/* Other coaches' plans — server-side gate (coach-plan-access.server.ts)      */
/* -------------------------------------------------------------------------- */

type Row = Record<string, any>;

/**
 * A read-only, in-memory Supabase-shaped fake covering these functions' query
 * shapes: `.select/.eq/.neq/.in/.gte/.or/.order` with `.single/.maybeSingle`,
 * bare await, `{ count, head }` selects and `rpc`. Joined columns
 * (`coach_profiles`, `parent_profiles`) are seeded pre-joined. Test-only.
 */
function fakeAdmin(seed: Record<string, Row[]>, tierByCoach: Record<string, string>) {
  function builder(table: string, filters: Array<(r: Row) => boolean>, head: boolean): any {
    const rows = () => (seed[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const add = (f: (r: Row) => boolean) => builder(table, [...filters, f], head);
    const api: any = {
      select: (_cols?: string, opts?: { head?: boolean }) => builder(table, filters, !!opts?.head),
      eq: (c: string, v: unknown) => add((r) => r[c] === v),
      neq: (c: string, v: unknown) => add((r) => r[c] !== v),
      in: (c: string, vs: unknown[]) => add((r) => vs.includes(r[c])),
      gte: (c: string, v: any) => add((r) => r[c] >= v),
      // Only the `col.eq.value,col.eq.value` form these modules use.
      or: (expr: string) =>
        add((r) =>
          expr.split(",").some((clause) => {
            const [c, op, ...v] = clause.split(".");
            if (op !== "eq") throw new Error(`fake or(): unsupported ${clause}`);
            return String(r[c]) === v.join(".");
          }),
        ),
      order: () => api,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown, reject?: unknown) =>
        Promise.resolve(
          head ? { data: null, count: rows().length, error: null } : { data: rows(), error: null },
        ).then(resolve, reject as never),
    };
    return api;
  }
  return {
    from: (table: string) => builder(table, [], false),
    rpc: async (fn: string, args: { _coach_id: string }) => {
      if (fn !== "coach_effective_tier") throw new Error(`fake rpc: unexpected ${fn}`);
      return { data: tierByCoach[args._coach_id] ?? "coach", error: null };
    },
  } as any;
}

const VIEWER = { id: "co-viewer", user_id: "u-viewer", first_name: "Val", last_name: "Viewer" };
const LINKED = { id: "co-linked", first_name: "Lee", last_name: "Linked" };
const OTHER = { id: "co-other", first_name: "Oona", last_name: "Other" };
const ATHLETE_ID = "ath-1";
const PARENT_ID = "par-1";
const NOW = new Date("2026-09-26T12:00:00.000Z");

type Scenario = {
  /** coach_effective_tier per coach id; absent = "coach". */
  tiers?: Record<string, string>;
  /** The primary parent's Team plan: live, lapsed (canceled and past its end), or never bought. */
  teamPlan?: "active" | "lapsed" | "none";
  /** The co-guardian carries the live Team plan instead of the primary parent. */
  teamPlanOnCoGuardian?: boolean;
  /** Link statuses between VIEWER and LINKED; null = no link row. */
  link?: { a: string; b: string } | null;
  /** Coaches the parent has opted in to sharing. */
  optIns?: string[];
};

function scenario(s: Scenario = {}) {
  const roster = (c: { id: string; first_name: string; last_name: string }) => ({
    coach_id: c.id,
    athlete_id: ATHLETE_ID,
    coach_profiles: { id: c.id, first_name: c.first_name, last_name: c.last_name },
  });
  const plan = (id: string, coachId: string, status: string, updated: string) => ({
    id,
    coach_id: coachId,
    athlete_id: ATHLETE_ID,
    kind: "plan",
    source: "coach",
    title: `Plan ${id}`,
    notes: `Private notes for ${id}`,
    status,
    updated_at: updated,
  });
  const teamPlan = s.teamPlan ?? "active";
  const subscription =
    teamPlan === "active"
      ? { subscription_status: "active", current_period_end: "2099-01-01T00:00:00.000Z" }
      : teamPlan === "lapsed"
        ? { subscription_status: "canceled", current_period_end: "2026-09-01T00:00:00.000Z" }
        : { subscription_status: null, current_period_end: null };
  const link = s.link === undefined ? { a: "accepted", b: "accepted" } : s.link;
  return fakeAdmin(
    {
      coach_profiles: [VIEWER, LINKED, OTHER],
      coach_athletes: [roster(VIEWER), roster(LINKED), roster(OTHER)],
      coach_athlete_sports: [
        { coach_id: LINKED.id, athlete_id: ATHLETE_ID, sport: "figure_skating" },
        { coach_id: OTHER.id, athlete_id: ATHLETE_ID, sport: "figure_skating" },
      ],
      athletes: [
        {
          id: ATHLETE_ID,
          first_name: "Ava",
          last_name: "Lee",
          self_managed: false,
          parent_id: PARENT_ID,
          parent_profiles: { first_name: "Pat", last_name: "Lee" },
        },
      ],
      parent_profiles: [
        {
          id: PARENT_ID,
          ...(s.teamPlanOnCoGuardian ? { subscription_status: null } : subscription),
        },
        {
          id: "par-2",
          ...(s.teamPlanOnCoGuardian
            ? { subscription_status: "trialing", current_period_end: null }
            : { subscription_status: null }),
        },
      ],
      athlete_guardians: [
        { athlete_id: ATHLETE_ID, parent_id: PARENT_ID },
        { athlete_id: ATHLETE_ID, parent_id: "par-2" },
      ],
      plans: [
        plan("p-linked", LINKED.id, "active", "2026-09-20T00:00:00.000Z"),
        plan("p-other-a", OTHER.id, "active", "2026-09-22T00:00:00.000Z"),
        plan("p-other-b", OTHER.id, "benched", "2026-09-10T00:00:00.000Z"),
      ],
      plan_moves: [
        {
          plan_id: "p-other-a",
          position: 0,
          name: "Axel",
          description: "",
          cue: "Tall",
          why: "",
          target_kind: "reps",
          target_value: 5,
        },
      ],
      coach_visibility_links: link
        ? [
            {
              athlete_id: ATHLETE_ID,
              coach_a_id: VIEWER.id,
              coach_b_id: LINKED.id,
              a_status: link.a,
              b_status: link.b,
            },
          ]
        : [],
      athlete_coach_visibility: (s.optIns ?? [VIEWER.id, LINKED.id]).map((coach_id) => ({
        athlete_id: ATHLETE_ID,
        coach_id,
      })),
    },
    s.tiers ?? {},
  );
}

async function detail(s: Scenario = {}) {
  const d = await getCoachAthleteDetail(
    { userId: VIEWER.user_id, admin: scenario(s) },
    ATHLETE_ID,
    NOW,
  );
  return { d, byId: new Map(d.otherCoaches.map((c) => [c.coachId, c])) };
}

async function planFromThread(planId: string, s: Scenario = {}) {
  return getOtherCoachPlanForMessage({ userId: VIEWER.user_id, admin: scenario(s) }, planId, NOW);
}

describe("getCoachAthleteDetail — other coaches' plans", () => {
  it("a non-Club viewer gets no plans for a coach without a link, but keeps the counts", async () => {
    for (const tier of ["coach", "coach_pro"]) {
      const other = (await detail({ tiers: { [VIEWER.id]: tier } })).byId.get(OTHER.id)!;
      expect(other.plans).toEqual([]);
      expect(other.activeCount).toBe(1);
      expect(other.benchedCount).toBe(1);
      expect(other.firstName).toBe("Oona");
      expect(JSON.stringify(other)).not.toContain("Private notes");
    }
  });

  it("a live, double-accepted link unlocks that coach for Coach and Pro viewers", async () => {
    for (const tier of ["coach", "coach_pro"]) {
      const { d, byId } = await detail({ tiers: { [VIEWER.id]: tier } });
      expect(byId.get(LINKED.id)!.plans.map((p) => p.planId)).toEqual(["p-linked"]);
      expect(byId.get(LINKED.id)!.plans[0].notes).toBe("Private notes for p-linked");
      expect(d.sharedCoachIds).toEqual([LINKED.id]);
      expect(d.coachVisibility[LINKED.id]).toBe("accepted");
    }
  });

  it("a Club viewer gets every other coach's plans, notes and moves without a link", async () => {
    const { byId } = await detail({ tiers: { [VIEWER.id]: "club" }, link: null });
    const other = byId.get(OTHER.id)!;
    expect(other.plans.map((p) => p.planId)).toEqual(["p-other-a", "p-other-b"]);
    expect(other.plans[0].moves.map((m) => m.name)).toEqual(["Axel"]);
    expect(byId.get(LINKED.id)!.plans).toHaveLength(1);
  });

  it("does not unlock on a pending link, and reports it as pending", async () => {
    const { d, byId } = await detail({ link: { a: "accepted", b: "pending" } });
    expect(d.coachVisibility[LINKED.id]).toBe("pending");
    expect(byId.get(LINKED.id)!.plans).toEqual([]);
    expect(byId.get(LINKED.id)!.activeCount).toBe(1);
  });

  it("does not unlock once the parent's opt-in for either coach is off", async () => {
    for (const optIns of [[VIEWER.id], [LINKED.id]]) {
      const { d, byId } = await detail({ optIns });
      expect(byId.get(LINKED.id)!.plans).toEqual([]);
      expect(d.sharedCoachIds).toEqual([]);
      expect(d.coachVisibility[LINKED.id]).toBeUndefined();
    }
  });

  it("a lapsed Team plan locks a link between two Coach-tier coaches", async () => {
    for (const teamPlan of ["lapsed", "none"] as const) {
      const { d, byId } = await detail({ teamPlan });
      expect(byId.get(LINKED.id)!.plans).toEqual([]);
      expect(byId.get(LINKED.id)!.activeCount).toBe(1);
      expect(d.sharedCoachIds).toEqual([]);
      // Not "accepted" any more, so neither client shows it as connected.
      expect(d.coachVisibility[LINKED.id]).toBeUndefined();
    }
  });

  it("a lapsed Team plan keeps the link when either coach in the pair is on Pro or Club", async () => {
    for (const tiers of [
      { [VIEWER.id]: "coach_pro" },
      { [LINKED.id]: "coach_pro" },
      { [LINKED.id]: "club" },
    ]) {
      const { d, byId } = await detail({ teamPlan: "lapsed", tiers });
      expect(byId.get(LINKED.id)!.plans.map((p) => p.planId)).toEqual(["p-linked"]);
      expect(d.sharedCoachIds).toEqual([LINKED.id]);
      expect(d.coachVisibility[LINKED.id]).toBe("accepted");
    }
  });

  it("a co-guardian's live Team plan covers the link", async () => {
    const { d } = await detail({ teamPlan: "none", teamPlanOnCoGuardian: true });
    expect(d.sharedCoachIds).toEqual([LINKED.id]);
  });

  it("a Pro coach elsewhere on the roster doesn't cover a pair it isn't in", async () => {
    const { d } = await detail({ teamPlan: "lapsed", tiers: { [OTHER.id]: "coach_pro" } });
    expect(d.sharedCoachIds).toEqual([]);
  });
});

describe("getOtherCoachPlanForMessage — same gate from a message thread", () => {
  it("opens for a viewer with a live link", async () => {
    const res = await planFromThread("p-linked");
    expect(res.coach.coachId).toBe(LINKED.id);
    expect(res.coach.plans.map((p) => p.notes)).toEqual(["Private notes for p-linked"]);
  });

  it("opens for a Club viewer without a link", async () => {
    const res = await planFromThread("p-other-a", { tiers: { [VIEWER.id]: "club" } });
    expect(res.coach.plans[0].moves.map((m) => m.name)).toEqual(["Axel"]);
  });

  it("refuses a Pro viewer without a link, and a lapsed link between Coach-tier coaches", async () => {
    const cases: Array<[string, Scenario]> = [
      ["p-other-a", { tiers: { [VIEWER.id]: "coach_pro" } }],
      ["p-linked", { teamPlan: "lapsed" }],
      ["p-linked", { link: { a: "accepted", b: "pending" } }],
    ];
    for (const [planId, s] of cases) {
      const err = await planFromThread(planId, s).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(403);
      expect((err as ApiError).code).toBe("plan_required");
    }
  });

  it("keeps the lapsed link open when the plan's coach is on Pro", async () => {
    const res = await planFromThread("p-linked", {
      teamPlan: "lapsed",
      tiers: { [LINKED.id]: "coach_pro" },
    });
    expect(res.coach.coachId).toBe(LINKED.id);
  });
});
