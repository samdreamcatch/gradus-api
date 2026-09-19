import { describe, expect, it } from "bun:test";
import {
  getTeamPlanStatus,
  guardianAthleteAccess,
  resolveGuardianAthleteAccess,
} from "./team.server";

/** A chainable fake: `rows[table]` answers `maybeSingle`/`single`; `lists[table]` answers awaited selects. */
function fakeClient(rows: Record<string, unknown | null>, lists: Record<string, unknown[]> = {}) {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    for (const m of [
      "select",
      "eq",
      "neq",
      "in",
      "lte",
      "gte",
      "lt",
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
    // Awaiting the chain itself (list reads and writes) resolves to the list.
    self.then = (resolve: (v: unknown) => void) =>
      resolve({ data: lists[table] ?? [], error: null });
    return self;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => chain(table) } as any;
}

const now = new Date("2026-09-06T12:00:00Z");

function status(profile: Record<string, unknown> | null) {
  return getTeamPlanStatus(
    { userId: "u", supabase: fakeClient({ parent_profiles: profile }) },
    now,
  );
}

describe("getTeamPlanStatus", () => {
  it("an active plan with a future period end is active", async () => {
    expect(
      await status({
        subscription_status: "active",
        current_period_end: "2026-10-06T00:00:00Z",
        stripe_customer_id: "cus_1",
      }),
    ).toEqual({
      active: true,
      status: "active",
      currentPeriodEnd: "2026-10-06T00:00:00Z",
      hasBillingAccount: true,
    });
  });

  it("a canceled plan stays active until its period ends, then not", async () => {
    expect(
      (
        await status({
          subscription_status: "canceled",
          current_period_end: "2026-10-06T00:00:00Z",
          stripe_customer_id: "cus_1",
        })
      ).active,
    ).toBe(true);
    expect(
      (
        await status({
          subscription_status: "canceled",
          current_period_end: "2026-08-06T00:00:00Z",
          stripe_customer_id: "cus_1",
        })
      ).active,
    ).toBe(false);
  });

  it("no period end means not expired; an unknown status is inactive", async () => {
    expect(
      (
        await status({
          subscription_status: "trialing",
          current_period_end: null,
          stripe_customer_id: null,
        })
      ).active,
    ).toBe(true);
    expect(
      (
        await status({
          subscription_status: "incomplete",
          current_period_end: null,
          stripe_customer_id: null,
        })
      ).active,
    ).toBe(false);
  });

  it("a null status is inactive, and hasBillingAccount follows stripe_customer_id", async () => {
    expect(
      await status({
        subscription_status: null,
        current_period_end: null,
        stripe_customer_id: "cus_1",
      }),
    ).toEqual({ active: false, status: null, currentPeriodEnd: null, hasBillingAccount: true });
  });

  it("a user without a parent profile is inactive with no billing account", async () => {
    expect(await status(null)).toEqual({
      active: false,
      status: null,
      currentPeriodEnd: null,
      hasBillingAccount: false,
    });
  });
});

/**
 * A fake tailored to `guardianAthleteAccess`: `athletes`/`athlete_guardians`
 * answer as flat lists (filters aren't applied, matching the other fakes in
 * this codebase); `parent_profiles` answers `maybeSingle` keyed by the id
 * from `.eq("id", ...)`, so distinct primaries can carry distinct plan
 * states. `planLookups` records every `parent_profiles` id looked up, so a
 * test can assert `teamPlanActive` was batched once per distinct primary.
 */
function fakeAccessListClient(
  lists: { athletes?: unknown[]; athlete_guardians?: unknown[] },
  parentProfilesById: Record<string, Record<string, unknown> | null> = {},
  planLookups: string[] = [],
) {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    let lastId: string | undefined;
    self.select = () => self;
    self.eq = (col: string, val: string) => {
      if (table === "parent_profiles" && col === "id") lastId = val;
      return self;
    };
    self.maybeSingle = async () => {
      if (table !== "parent_profiles") return { data: null, error: null };
      planLookups.push(lastId as string);
      return { data: parentProfilesById[lastId as string] ?? null, error: null };
    };
    self.then = (resolve: (v: unknown) => void) =>
      resolve({ data: (lists as Record<string, unknown[]>)[table] ?? [], error: null });
    return self;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => chain(table) } as any;
}

describe("guardianAthleteAccess", () => {
  it("includes the primary's own athletes, always unlocked", async () => {
    const admin = fakeAccessListClient({ athletes: [{ id: "a1" }] });
    expect(await guardianAthleteAccess(admin, "parent-1")).toEqual([
      { athleteId: "a1", role: "primary", locked: false },
    ]);
  });

  it("a co-guardian athlete is unlocked while the primary's Team plan is active", async () => {
    const admin = fakeAccessListClient(
      { athlete_guardians: [{ athlete_id: "a2", athletes: { parent_id: "primary-1" } }] },
      { "primary-1": { subscription_status: "active", current_period_end: null } },
    );
    expect(await guardianAthleteAccess(admin, "parent-2")).toEqual([
      { athleteId: "a2", role: "co", locked: false },
    ]);
  });

  it("a co-guardian athlete is locked once the primary's Team plan has lapsed", async () => {
    const admin = fakeAccessListClient(
      { athlete_guardians: [{ athlete_id: "a2", athletes: { parent_id: "primary-1" } }] },
      { "primary-1": { subscription_status: null, current_period_end: null } },
    );
    expect(await guardianAthleteAccess(admin, "parent-2")).toEqual([
      { athleteId: "a2", role: "co", locked: true },
    ]);
  });

  it("a guardian spanning two primaries gets independent lock flags, one plan lookup per primary", async () => {
    const planLookups: string[] = [];
    const admin = fakeAccessListClient(
      {
        athlete_guardians: [
          { athlete_id: "active-kid", athletes: { parent_id: "primary-active" } },
          { athlete_id: "lapsed-kid", athletes: { parent_id: "primary-lapsed" } },
        ],
      },
      {
        "primary-active": { subscription_status: "active", current_period_end: null },
        "primary-lapsed": { subscription_status: null, current_period_end: null },
      },
      planLookups,
    );
    const access = await guardianAthleteAccess(admin, "parent-2");
    expect([...access].sort((a, b) => a.athleteId.localeCompare(b.athleteId))).toEqual([
      { athleteId: "active-kid", role: "co", locked: false },
      { athleteId: "lapsed-kid", role: "co", locked: true },
    ]);
    expect(planLookups.sort()).toEqual(["primary-active", "primary-lapsed"]);
  });

  it("primary role wins when the same athlete also has a (redundant) guardian row", async () => {
    const admin = fakeAccessListClient({
      athletes: [{ id: "a1" }],
      athlete_guardians: [{ athlete_id: "a1", athletes: { parent_id: "parent-1" } }],
    });
    expect(await guardianAthleteAccess(admin, "parent-1")).toEqual([
      { athleteId: "a1", role: "primary", locked: false },
    ]);
  });
});

/** A fake tailored to `resolveGuardianAthleteAccess`'s single-row lookups. */
function fakeAccessSingleClient(opts: {
  athlete?: { id: string; parent_id: string | null } | null;
  guardianLink?: { id: string } | null;
  planStatus?: Record<string, unknown> | null;
}) {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    self.select = () => self;
    self.eq = () => self;
    self.maybeSingle = async () => {
      if (table === "athletes") return { data: opts.athlete ?? null, error: null };
      if (table === "athlete_guardians") return { data: opts.guardianLink ?? null, error: null };
      if (table === "parent_profiles") return { data: opts.planStatus ?? null, error: null };
      return { data: null, error: null };
    };
    return self;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => chain(table) } as any;
}

describe("resolveGuardianAthleteAccess", () => {
  it("returns null when the athlete doesn't exist", async () => {
    const admin = fakeAccessSingleClient({ athlete: null });
    expect(await resolveGuardianAthleteAccess(admin, "parent-1", "ghost")).toBeNull();
  });

  it("returns null when the caller has no link to the athlete at all", async () => {
    const admin = fakeAccessSingleClient({
      athlete: { id: "a1", parent_id: "someone-else" },
      guardianLink: null,
    });
    expect(await resolveGuardianAthleteAccess(admin, "parent-1", "a1")).toBeNull();
  });

  it("the primary parent is never locked", async () => {
    const admin = fakeAccessSingleClient({ athlete: { id: "a1", parent_id: "parent-1" } });
    expect(await resolveGuardianAthleteAccess(admin, "parent-1", "a1")).toEqual({
      athleteId: "a1",
      role: "primary",
      locked: false,
    });
  });

  it("a co-guardian is unlocked while the primary's plan is active, locked once it lapses", async () => {
    const linked = {
      athlete: { id: "a1", parent_id: "primary-1" },
      guardianLink: { id: "link-1" },
    };
    const active = await resolveGuardianAthleteAccess(
      fakeAccessSingleClient({ ...linked, planStatus: { subscription_status: "active" } }),
      "parent-2",
      "a1",
    );
    expect(active).toEqual({ athleteId: "a1", role: "co", locked: false });

    const lapsed = await resolveGuardianAthleteAccess(
      fakeAccessSingleClient({ ...linked, planStatus: null }),
      "parent-2",
      "a1",
    );
    expect(lapsed).toEqual({ athleteId: "a1", role: "co", locked: true });
  });
});
