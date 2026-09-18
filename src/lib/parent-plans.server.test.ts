import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import { getParentPlan, listParentPlans } from "./parent-plans.server";

async function caught(run: () => Promise<unknown>): Promise<ApiError | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof ApiError ? err : null;
  }
}

/**
 * A bespoke fake covering both `listParentPlans` and `getParentPlan`'s query
 * shapes: `.eq("parent_id", ...)` on `athletes` answers the "own athletes"
 * lookup (used by `guardianAthleteAccess`) separately from `.in("id", ...)`
 * on the same table (the athlete-detail read), and `parent_profiles`
 * answers differently for `.eq("user_id", ...)` (the caller) vs.
 * `.eq("id", ...)` (a co-guardian athlete's primary, for the plan check).
 */
function fakePlansClient(opts: {
  callerParentId: string;
  ownAthletes?: { id: string; first_name: string; last_name: string }[];
  guardianRows?: { athlete_id: string; athletes: { parent_id: string | null } }[];
  primaryPlanStatus?: Record<string, Record<string, unknown> | null>;
  athleteDetails?: { id: string; first_name: string; last_name: string }[];
  athleteSingle?: Record<string, unknown> | null;
  plan?: Record<string, unknown> | null;
  planRows?: Record<string, unknown>[];
}) {
  const client = {
    from(table: string) {
      const self: Record<string, unknown> = {};
      let mode: string | null = null;
      let lastEqVal: string | undefined;
      self.select = () => self;
      self.order = () => self;
      self.in = () => {
        if (table === "athletes") mode = "detail";
        if (table === "plans") mode = "list";
        return self;
      };
      self.eq = (col: string, val: string) => {
        lastEqVal = val;
        if (table === "parent_profiles" && col === "user_id") mode = "caller";
        if (table === "parent_profiles" && col === "id") mode = "primaryPlan";
        if (table === "athletes" && col === "parent_id") mode = "own";
        if (table === "athletes" && col === "id") mode = "single";
        if (table === "plans" && col === "id") mode = "single";
        if (table === "plans" && col === "kind") return self;
        if (table === "plans" && col === "status") return self;
        return self;
      };
      self.maybeSingle = async () => {
        if (mode === "caller") return { data: { id: opts.callerParentId }, error: null };
        if (mode === "primaryPlan") {
          return { data: opts.primaryPlanStatus?.[lastEqVal as string] ?? null, error: null };
        }
        if (table === "athletes" && mode === "single") {
          return { data: opts.athleteSingle ?? null, error: null };
        }
        if (table === "plans" && mode === "single") return { data: opts.plan ?? null, error: null };
        if (table === "athlete_guardians") {
          const linked = (opts.guardianRows ?? []).length > 0;
          return { data: linked ? { id: "link-1" } : null, error: null };
        }
        return { data: null, error: null };
      };
      self.then = (resolve: (v: unknown) => void) => {
        if (table === "athletes" && mode === "own") {
          return resolve({ data: opts.ownAthletes ?? [], error: null });
        }
        if (table === "athletes" && mode === "detail") {
          return resolve({ data: opts.athleteDetails ?? [], error: null });
        }
        if (table === "athlete_guardians") {
          return resolve({ data: opts.guardianRows ?? [], error: null });
        }
        if (table === "plans" && mode === "list") {
          return resolve({ data: opts.planRows ?? [], error: null });
        }
        return resolve({ data: [], error: null });
      };
      return self;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { supabase: client, admin: client };
}

describe("listParentPlans", () => {
  it("a locked co-guardian's athlete is listed by name but contributes no plans", async () => {
    const { supabase, admin } = fakePlansClient({
      callerParentId: "parent-2",
      guardianRows: [
        { athlete_id: "a1", athletes: { parent_id: "primary-1" } },
      ],
      athleteDetails: [{ id: "a1", first_name: "Kid", last_name: "Guardianed" }],
      primaryPlanStatus: { "primary-1": { subscription_status: null, current_period_end: null } },
    });
    expect(await listParentPlans({ userId: "u2", supabase, admin })).toEqual({
      athletes: [{ id: "a1", name: "Kid Guardianed", locked: true }],
      plans: [],
    });
  });

  it("a primary parent's athlete is unlocked", async () => {
    const { supabase, admin } = fakePlansClient({
      callerParentId: "parent-1",
      ownAthletes: [{ id: "a1", first_name: "Kid", last_name: "Primary" }],
      athleteDetails: [{ id: "a1", first_name: "Kid", last_name: "Primary" }],
    });
    const result = await listParentPlans({ userId: "u1", supabase, admin });
    expect(result.athletes).toEqual([{ id: "a1", name: "Kid Primary", locked: false }]);
  });
});

describe("getParentPlan", () => {
  const plan = {
    id: "plan-1",
    title: "Weekly plan",
    notes: "",
    status: "active",
    athlete_id: "a1",
    coach_id: null,
    updated_at: "2026-01-01T00:00:00Z",
    kind: "plan",
    source: "gradus",
  };

  it("refuses a plan whose athlete has lapsed out of the caller's Team plan", async () => {
    const { supabase, admin } = fakePlansClient({
      callerParentId: "parent-2",
      plan,
      athleteSingle: { id: "a1", parent_id: "primary-1" },
      guardianRows: [{ athlete_id: "a1", athletes: { parent_id: "primary-1" } }],
      primaryPlanStatus: { "primary-1": { subscription_status: null, current_period_end: null } },
    });
    const err = await caught(() => getParentPlan({ userId: "u2", supabase, admin }, "plan-1"));
    expect(err?.status).toBe(403);
    expect(err?.code).toBe("plan_required");
  });

  it("404s for a plan whose athlete the caller has no link to at all", async () => {
    const { supabase, admin } = fakePlansClient({
      callerParentId: "parent-3",
      plan,
      guardianRows: [],
      athleteSingle: null,
    });
    const err = await caught(() => getParentPlan({ userId: "u3", supabase, admin }, "plan-1"));
    expect(err?.status).toBe(404);
  });

  it("returns the plan detail for the primary parent", async () => {
    const { supabase, admin } = fakePlansClient({
      callerParentId: "a1-primary",
      athleteSingle: { id: "a1", parent_id: "a1-primary" },
      plan,
    });
    const detail = await getParentPlan({ userId: "u1", supabase, admin }, "plan-1");
    expect(detail.id).toBe("plan-1");
    expect(detail.title).toBe("Weekly plan");
  });
});
