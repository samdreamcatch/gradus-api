import { describe, expect, it } from "bun:test";
import { getResourcesForCaller } from "./resources.server";

/** Admin fake: `profiles[table]` answers that table's `maybeSingle`. */
function fakeAdmin(profiles: Record<string, unknown | null>) {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "limit"]) self[m] = () => self;
    self.maybeSingle = async () => ({ data: profiles[table] ?? null, error: null });
    return self;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => chain(table) } as any;
}

/** A supabase fake that answers every `maybeSingle` with null and every awaited list with []. */
function emptySupabase() {
  const self: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is", "not", "order", "limit"]) self[m] = () => self;
  self.maybeSingle = async () => ({ data: null, error: null });
  self.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: () => self } as any;
}

describe("getResourcesForCaller", () => {
  it("serves the store app: the curated library is filtered to confirmed rights", async () => {
    // An athlete with a golf goal, so the library query actually runs.
    const seen = { rightsFilters: [] as string[][] };
    const chain = (table: string) => {
      const self: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "not", "order", "limit"]) self[m] = () => self;
      self.in = (col: string, values: string[]) => {
        if (col === "rights") seen.rightsFilters.push(values);
        return self;
      };
      self.maybeSingle = async () => ({
        data: table === "athletes" ? { id: "a1", birthdate: null } : null,
        error: null,
      });
      self.then = (resolve: (v: unknown) => void) => {
        if (table === "athlete_goals") return resolve({ data: [{ sport: "golf" }], error: null });
        return resolve({ data: [], error: null });
      };
      return self;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = { from: (table: string) => chain(table) } as any;
    const admin = fakeAdmin({
      coach_profiles: null,
      parent_profiles: null,
      athletes: { id: "a1" },
    });
    const result = await getResourcesForCaller({ userId: "u1", supabase, admin });
    expect(result.role).toBe("athlete");
    expect(seen.rightsFilters).toEqual([["gradus", "licensed"]]);
  });

  it("dispatches to the coach feed, tagged role: coach, when a coach_profiles row exists", async () => {
    const admin = fakeAdmin({ coach_profiles: { id: "c1" } });
    const result = await getResourcesForCaller({ userId: "u1", supabase: emptySupabase(), admin });
    expect(result.role).toBe("coach");
    expect(result.parent).toBeNull();
    expect(result.athlete).toBeNull();
    expect(result.coach).toMatchObject({ sports: [], resources: [], canUpload: false });
  });

  it("dispatches to the parent feed, tagged role: parent, when only parent_profiles has a row", async () => {
    const admin = fakeAdmin({ coach_profiles: null, parent_profiles: { id: "p1" } });
    const result = await getResourcesForCaller({ userId: "u1", supabase: emptySupabase(), admin });
    expect(result.role).toBe("parent");
    expect(result.coach).toBeNull();
    expect(result.athlete).toBeNull();
    expect(result.parent).toMatchObject({ sports: [], resources: [] });
  });

  it("dispatches to the athlete feed, tagged role: athlete, when only athletes has a row", async () => {
    const admin = fakeAdmin({
      coach_profiles: null,
      parent_profiles: null,
      athletes: { id: "a1" },
    });
    const result = await getResourcesForCaller({ userId: "u1", supabase: emptySupabase(), admin });
    expect(result.role).toBe("athlete");
    expect(result.coach).toBeNull();
    expect(result.parent).toBeNull();
    expect(result.athlete).toMatchObject({ sports: [], resources: [] });
  });

  it("falls back to an empty parent-shaped feed when the caller has no profile at all", async () => {
    const admin = fakeAdmin({ coach_profiles: null, parent_profiles: null, athletes: null });
    const result = await getResourcesForCaller({ userId: "u1", supabase: emptySupabase(), admin });
    expect(result).toEqual({ role: "parent", coach: null, parent: null, athlete: null });
  });

  it("prefers an onboarded coach over parent and athlete when more than one profile exists", async () => {
    const admin = fakeAdmin({
      coach_profiles: { id: "c1", onboarded_at: "2026-01-01T00:00:00Z" },
      parent_profiles: { id: "p1" },
      athletes: { id: "a1" },
    });
    const result = await getResourcesForCaller({ userId: "u1", supabase: emptySupabase(), admin });
    expect(result.role).toBe("coach");
  });

  it("prefers parent over an un-onboarded coach, matching GET /api/v1/me's precedence", async () => {
    const admin = fakeAdmin({
      coach_profiles: { id: "c1", onboarded_at: null },
      parent_profiles: { id: "p1" },
      athletes: null,
    });
    const result = await getResourcesForCaller({ userId: "u1", supabase: emptySupabase(), admin });
    expect(result.role).toBe("parent");
  });

  it("prefers athlete over an un-onboarded coach when there is no parent profile", async () => {
    const admin = fakeAdmin({
      coach_profiles: { id: "c1", onboarded_at: null },
      parent_profiles: null,
      athletes: { id: "a1" },
    });
    const result = await getResourcesForCaller({ userId: "u1", supabase: emptySupabase(), admin });
    expect(result.role).toBe("athlete");
  });

  it("still falls back to coach when the coach is un-onboarded and no other profile exists", async () => {
    const admin = fakeAdmin({
      coach_profiles: { id: "c1", onboarded_at: null },
      parent_profiles: null,
      athletes: null,
    });
    const result = await getResourcesForCaller({ userId: "u1", supabase: emptySupabase(), admin });
    expect(result.role).toBe("coach");
  });
});
