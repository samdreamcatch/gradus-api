import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import { askerCoachIds, resolveAskGradusAudience } from "./ask-gradus-audience.server";

/** Admin fake: `profiles[table]` answers that table's `maybeSingle` — used
 * for both `resolveCallerRole`'s profile lookups and the athlete birthdate
 * read, since both query the same tables through the same admin client. */
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

async function caught(run: () => Promise<unknown>): Promise<ApiError | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof ApiError ? err : null;
  }
}

function birthdateYearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

/**
 * Admin fake for the case where the caller's role resolves to "athlete"
 * (the `athletes` row exists for the `.select("id")` role check) but the
 * follow-up `.select("birthdate")` eligibility read on that same table
 * errors — e.g. a duplicate-rows PGRST116 from `.maybeSingle()`. Ported
 * from the since-superseded `ask-gradus.functions.ts` local
 * `resolveAskGradusAudience`'s own regression test for this: a query error
 * must never be treated the same as "no matching row" and silently
 * resolved to the parent persona.
 */
function fakeAdminWithAthleteLookupError() {
  const passthrough = () => {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "limit"]) self[m] = () => self;
    self.maybeSingle = async () => ({ data: null, error: null });
    return self;
  };
  return {
    from: (table: string) => {
      if (table !== "athletes") return passthrough();
      return {
        select: (columns: string) => {
          const self: Record<string, unknown> = {};
          for (const m of ["eq", "limit"]) self[m] = () => self;
          self.maybeSingle = async () =>
            columns === "id"
              ? { data: { id: "a1" }, error: null } // role resolution: caller is an athlete
              : { data: null, error: { code: "PGRST116", message: "multiple rows returned" } };
          return self;
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeSupabase = {} as any;

describe("resolveAskGradusAudience", () => {
  it("refuses a minor athlete with a birthdate on file — 403 ask_gradus_unavailable", async () => {
    const admin = fakeAdmin({
      coach_profiles: null,
      parent_profiles: null,
      athletes: { id: "a1", birthdate: birthdateYearsAgo(10) },
    });
    const err = await caught(() =>
      resolveAskGradusAudience({ userId: "u1", supabase: fakeSupabase, admin }, "athlete"),
    );
    expect(err?.code).toBe("ask_gradus_unavailable");
    expect(err?.status).toBe(403);
  });

  it("refuses an athlete with no birthdate on file — age can't be confirmed", async () => {
    const admin = fakeAdmin({
      coach_profiles: null,
      parent_profiles: null,
      athletes: { id: "a1", birthdate: null },
    });
    const err = await caught(() =>
      resolveAskGradusAudience({ userId: "u1", supabase: fakeSupabase, admin }, "athlete"),
    );
    expect(err?.code).toBe("ask_gradus_unavailable");
    expect(err?.status).toBe(403);
  });

  it("grants a confirmed 18+ athlete audience 'athlete', regardless of what the client sent", async () => {
    const admin = fakeAdmin({
      coach_profiles: null,
      parent_profiles: null,
      athletes: { id: "a1", birthdate: birthdateYearsAgo(30) },
    });
    const result = await resolveAskGradusAudience(
      { userId: "u1", supabase: fakeSupabase, admin },
      "parent",
    );
    expect(result).toBe("athlete");
  });

  it("forces a parent to audience 'parent' even when they send audience: 'athlete'", async () => {
    const admin = fakeAdmin({
      coach_profiles: null,
      parent_profiles: { id: "p1" },
      athletes: null,
    });
    const result = await resolveAskGradusAudience(
      { userId: "u1", supabase: fakeSupabase, admin },
      "athlete",
    );
    expect(result).toBe("parent");
  });

  it("forces a coach to audience 'parent' even when they send audience: 'athlete'", async () => {
    const admin = fakeAdmin({
      coach_profiles: { id: "c1", onboarded_at: "2026-01-01T00:00:00Z" },
      parent_profiles: null,
      athletes: null,
    });
    const result = await resolveAskGradusAudience(
      { userId: "u1", supabase: fakeSupabase, admin },
      "athlete",
    );
    expect(result).toBe("parent");
  });

  it("forces a caller with no profile at all to audience 'parent'", async () => {
    const admin = fakeAdmin({ coach_profiles: null, parent_profiles: null, athletes: null });
    const result = await resolveAskGradusAudience(
      { userId: "u1", supabase: fakeSupabase, admin },
      "athlete",
    );
    expect(result).toBe("parent");
  });

  it("refuses an athlete with an unparseable birthdate on file", async () => {
    const admin = fakeAdmin({
      coach_profiles: null,
      parent_profiles: null,
      athletes: { id: "a1", birthdate: "not-a-date" },
    });
    const err = await caught(() =>
      resolveAskGradusAudience({ userId: "u1", supabase: fakeSupabase, admin }, "athlete"),
    );
    expect(err?.code).toBe("ask_gradus_unavailable");
    expect(err?.status).toBe(403);
  });

  it("fails closed — not to 'parent' — when the athlete birthdate lookup itself errors", async () => {
    const admin = fakeAdminWithAthleteLookupError();
    await expect(
      resolveAskGradusAudience({ userId: "u1", supabase: fakeSupabase, admin }, "athlete"),
    ).rejects.toThrow();
  });
});

describe("askerCoachIds (L5: whose own uploads may ground an answer)", () => {
  /** Answers each table from `rows`; `in`/`eq` filters are recorded, not applied. */
  function admin(rows: Record<string, unknown>) {
    const from = (table: string) => {
      const self: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in"]) self[m] = () => self;
      const value = rows[table];
      self.maybeSingle = async () => ({
        data: Array.isArray(value) ? null : (value ?? null),
        error: null,
      });
      self.then = (resolve: (v: unknown) => void) =>
        resolve({ data: Array.isArray(value) ? value : [], error: null });
      return self;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { from } as any;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = (a: unknown) => ({ userId: "u1", supabase: {} as any, admin: a as any });

  it("a parent gets the coaches of the athletes they parent or co-guard", async () => {
    const ids = await askerCoachIds(
      ctx(
        admin({
          parent_profiles: { id: "p1" },
          athletes: [{ id: "a1" }],
          athlete_guardians: [{ athlete_id: "a2" }],
          coach_athletes: [{ coach_id: "c1" }, { coach_id: "c2" }, { coach_id: "c1" }],
        }),
      ),
    );
    expect(ids.sort()).toEqual(["c1", "c2"]);
  });

  it("a coach gets only themselves; nobody gets anything on a failed read", async () => {
    expect(await askerCoachIds(ctx(admin({ coach_profiles: { id: "c9" } })))).toEqual(["c9"]);
    const broken = {
      from: () => {
        throw new Error("db down");
      },
    };
    expect(await askerCoachIds(ctx(broken))).toEqual([]);
  });
});
