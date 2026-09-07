import { describe, expect, it } from "bun:test";
import { resolveCallerRole } from "./caller-role.server";

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

describe("resolveCallerRole", () => {
  it("resolves to coach when an onboarded coach_profiles row exists", async () => {
    const admin = fakeAdmin({ coach_profiles: { id: "c1", onboarded_at: "2026-01-01T00:00:00Z" } });
    expect(await resolveCallerRole(admin, "u1")).toBe("coach");
  });

  it("resolves to parent when only parent_profiles has a row", async () => {
    const admin = fakeAdmin({ coach_profiles: null, parent_profiles: { id: "p1" } });
    expect(await resolveCallerRole(admin, "u1")).toBe("parent");
  });

  it("resolves to athlete when only athletes has a row", async () => {
    const admin = fakeAdmin({
      coach_profiles: null,
      parent_profiles: null,
      athletes: { id: "a1" },
    });
    expect(await resolveCallerRole(admin, "u1")).toBe("athlete");
  });

  it("resolves to null when the caller has no profile at all", async () => {
    const admin = fakeAdmin({ coach_profiles: null, parent_profiles: null, athletes: null });
    expect(await resolveCallerRole(admin, "u1")).toBeNull();
  });

  it("prefers an onboarded coach over parent and athlete", async () => {
    const admin = fakeAdmin({
      coach_profiles: { id: "c1", onboarded_at: "2026-01-01T00:00:00Z" },
      parent_profiles: { id: "p1" },
      athletes: { id: "a1" },
    });
    expect(await resolveCallerRole(admin, "u1")).toBe("coach");
  });

  it("prefers parent over an un-onboarded coach", async () => {
    const admin = fakeAdmin({
      coach_profiles: { id: "c1", onboarded_at: null },
      parent_profiles: { id: "p1" },
      athletes: null,
    });
    expect(await resolveCallerRole(admin, "u1")).toBe("parent");
  });

  it("prefers athlete over an un-onboarded coach when there is no parent profile", async () => {
    const admin = fakeAdmin({
      coach_profiles: { id: "c1", onboarded_at: null },
      parent_profiles: null,
      athletes: { id: "a1" },
    });
    expect(await resolveCallerRole(admin, "u1")).toBe("athlete");
  });

  it("still falls back to coach when un-onboarded and no other profile exists", async () => {
    const admin = fakeAdmin({
      coach_profiles: { id: "c1", onboarded_at: null },
      parent_profiles: null,
      athletes: null,
    });
    expect(await resolveCallerRole(admin, "u1")).toBe("coach");
  });
});
