import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import { resolveAskGradusAudience } from "./ask-gradus-audience.server";

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
});
