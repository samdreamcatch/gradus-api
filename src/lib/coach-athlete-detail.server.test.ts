import { describe, expect, it } from "bun:test";
import { getCoachAthleteDetail, summarySessionLine } from "./coach-athlete-detail.server";
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
/* getCoachAthleteDetail — other coaches' plans are redacted server-side      */
/* -------------------------------------------------------------------------- */

type Row = Record<string, any>;

/**
 * A read-only, in-memory Supabase-shaped fake covering this function's query
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
      // Only the `col.eq.value,col.eq.value` form this module uses.
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

describe("getCoachAthleteDetail — other coaches' plans", () => {
  const VIEWER = { id: "co-viewer", user_id: "u-viewer", first_name: "Val", last_name: "Viewer" };
  const LINKED = { id: "co-linked", first_name: "Lee", last_name: "Linked" };
  const OTHER = { id: "co-other", first_name: "Oona", last_name: "Other" };
  const ATHLETE_ID = "ath-1";
  const NOW = new Date("2026-09-26T12:00:00.000Z");

  function seed(tier: string) {
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
    return fakeAdmin(
      {
        coach_profiles: [VIEWER],
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
            parent_profiles: { first_name: "Pat", last_name: "Lee" },
          },
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
        coach_visibility_links: [
          {
            athlete_id: ATHLETE_ID,
            coach_a_id: VIEWER.id,
            coach_b_id: LINKED.id,
            a_status: "accepted",
            b_status: "accepted",
          },
        ],
      },
      { [VIEWER.id]: tier },
    );
  }

  async function detail(tier: string) {
    const d = await getCoachAthleteDetail(
      { userId: VIEWER.user_id, admin: seed(tier) },
      ATHLETE_ID,
      NOW,
    );
    return new Map(d.otherCoaches.map((c) => [c.coachId, c]));
  }

  it("a non-Club viewer gets no plans for a coach without an accepted link, but keeps the counts", async () => {
    for (const tier of ["coach", "coach_pro"]) {
      const other = (await detail(tier)).get(OTHER.id)!;
      expect(other.plans).toEqual([]);
      expect(other.activeCount).toBe(1);
      expect(other.benchedCount).toBe(1);
      expect(other.firstName).toBe("Oona");
      expect(JSON.stringify(other)).not.toContain("Private notes");
    }
  });

  it("a non-Club viewer still gets plans for a coach unlocked by an accepted visibility link", async () => {
    const linked = (await detail("coach")).get(LINKED.id)!;
    expect(linked.plans.map((p) => p.planId)).toEqual(["p-linked"]);
    expect(linked.plans[0].notes).toBe("Private notes for p-linked");
  });

  it("a Club viewer gets every other coach's plans, notes and moves", async () => {
    const byId = await detail("club");
    const other = byId.get(OTHER.id)!;
    expect(other.plans.map((p) => p.planId)).toEqual(["p-other-a", "p-other-b"]);
    expect(other.plans[0].moves.map((m) => m.name)).toEqual(["Axel"]);
    expect(byId.get(LINKED.id)!.plans).toHaveLength(1);
  });

  it("does not unlock on a pending link", async () => {
    const admin = seed("coach");
    // Flip the link to pending on the other side.
    const res = await getCoachAthleteDetail(
      {
        userId: VIEWER.user_id,
        admin: {
          ...admin,
          from: (t: string) =>
            t === "coach_visibility_links"
              ? fakeAdmin(
                  {
                    coach_visibility_links: [
                      {
                        athlete_id: ATHLETE_ID,
                        coach_a_id: VIEWER.id,
                        coach_b_id: LINKED.id,
                        a_status: "accepted",
                        b_status: "pending",
                      },
                    ],
                  },
                  {},
                ).from(t)
              : admin.from(t),
        },
      },
      ATHLETE_ID,
      NOW,
    );
    const linked = res.otherCoaches.find((c) => c.coachId === LINKED.id)!;
    expect(res.coachVisibility[LINKED.id]).toBe("pending");
    expect(linked.plans).toEqual([]);
    expect(linked.activeCount).toBe(1);
  });
});
