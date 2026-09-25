import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import {
  UNDER_18_NEEDS_GUARDIAN,
  athleteSelfInput,
  getAthleteSettings,
  updateAthleteSelf,
} from "./athlete-settings.server";

type Filter = [column: string, value: unknown];
type Update = { table: string; payload: unknown; filters: Filter[] };
type FakeOptions = {
  /** Records every `update(payload)` with the `eq` filters chained after it. */
  updates?: Update[];
  /** What an awaited `update()` resolves to; `null` is success. */
  updateError?: { code?: string; message: string } | null;
};

/**
 * A chainable fake: `rows[table]` answers `maybeSingle`/`single`; awaited
 * chains resolve to `[]` (reads) or `updateError` (writes).
 */
function fakeClient(rows: Record<string, unknown | null>, opts: FakeOptions = {}) {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    const filters: Filter[] = [];
    let writing = false;
    for (const m of ["select", "order", "limit"]) self[m] = () => self;
    for (const m of ["eq", "neq", "in", "lte", "gte", "lt"]) {
      self[m] = (column: string, value: unknown) => {
        filters.push([column, value]);
        return self;
      };
    }
    self.update = (payload: unknown) => {
      writing = true;
      opts.updates?.push({ table, payload, filters });
      return self;
    };
    self.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
    self.single = async () => ({ data: rows[table] ?? null, error: null });
    self.then = (resolve: (v: unknown) => void) =>
      resolve(
        writing ? { data: null, error: opts.updateError ?? null } : { data: [], error: null },
      );
    return self;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => chain(table) } as any;
}

async function caughtAny(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return null;
  } catch (err) {
    return err;
  }
}

const base = {
  id: "a1",
  first_name: "Rory",
  last_name: "Gilmore",
  birthdate: "2012-04-01",
  username: null,
  parent_id: null,
  guardian_email: "lorelai@example.com",
  guardian_invited_at: "2026-09-01T00:00:00Z",
  guardian_claimed_at: null,
};

describe("athleteSelfInput", () => {
  it("requires trimmed names up to 80 characters and a YYYY-MM-DD or null birthdate", () => {
    expect(
      athleteSelfInput.parse({ firstName: " Rory ", lastName: "Gilmore", birthdate: null }),
    ).toEqual({ firstName: "Rory", lastName: "Gilmore", birthdate: null });
    expect(
      athleteSelfInput.safeParse({ firstName: "R", lastName: "G", birthdate: "2012-04-01" })
        .success,
    ).toBe(true);
    expect(
      athleteSelfInput.safeParse({ firstName: "R", lastName: "G", birthdate: "04/01/2012" })
        .success,
    ).toBe(false);
    expect(
      athleteSelfInput.safeParse({ firstName: "  ", lastName: "G", birthdate: null }).success,
    ).toBe(false);
    expect(
      athleteSelfInput.safeParse({ firstName: "x".repeat(81), lastName: "G", birthdate: null })
        .success,
    ).toBe(false);
  });
});

describe("getAthleteSettings", () => {
  it("is null for a user without an athlete row", async () => {
    expect(await getAthleteSettings({ userId: "u", admin: fakeClient({}) })).toBeNull();
  });

  it("a guardian on file who has not claimed is not yet in app", async () => {
    const settings = await getAthleteSettings({
      userId: "u",
      admin: fakeClient({ athletes: base }),
    });
    expect(settings).toEqual({
      id: "a1",
      firstName: "Rory",
      lastName: "Gilmore",
      birthdate: "2012-04-01",
      username: null,
      guardianEmail: "lorelai@example.com",
      guardianInvitedAt: "2026-09-01T00:00:00Z",
      guardianClaimed: false,
      accountState: "active",
    });
  });

  it("an athlete attached to a parent profile counts as claimed even without a claim stamp", async () => {
    const settings = await getAthleteSettings({
      userId: "u",
      admin: fakeClient({ athletes: { ...base, parent_id: "parent-1", username: "rory" } }),
    });
    expect(settings?.guardianClaimed).toBe(true);
    expect(settings?.username).toBe("rory");
  });

  it("a claim stamp alone also counts", async () => {
    const settings = await getAthleteSettings({
      userId: "u",
      admin: fakeClient({
        athletes: { ...base, guardian_claimed_at: "2026-09-02T00:00:00Z" },
      }),
    });
    expect(settings?.guardianClaimed).toBe(true);
  });
});

describe("updateAthleteSelf", () => {
  const input = { firstName: "Rory", lastName: "Gilmore", birthdate: "2012-04-01" };
  const written = {
    table: "athletes",
    payload: { first_name: "Rory", last_name: "Gilmore", birthdate: "2012-04-01" },
    filters: [["user_id", "u"]],
  };

  it("writes the three columns scoped to the caller's user_id (the admin client's only guard)", async () => {
    const updates: Update[] = [];
    expect(
      await updateAthleteSelf({ userId: "u", admin: fakeClient({}, { updates }) }, input),
    ).toEqual({ ok: true });
    expect(updates).toEqual([written]);
  });

  it("with apiContract, a caller without an athlete row is 404 not_found and nothing is written", async () => {
    const updates: Update[] = [];
    const err = await caughtAny(() =>
      updateAthleteSelf({ userId: "u", admin: fakeClient({}, { updates }) }, input, {
        apiContract: true,
      }),
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).code).toBe("not_found");
    expect((err as ApiError).message).toBe("Athlete not found");
    expect(updates).toEqual([]);
  });

  it("with apiContract, the caller's own row is written as before", async () => {
    const updates: Update[] = [];
    const admin = fakeClient({ athletes: { id: "a1" } }, { updates });
    expect(await updateAthleteSelf({ userId: "u", admin }, input, { apiContract: true })).toEqual({
      ok: true,
    });
    expect(updates).toEqual([written]);
  });

  const ageRule = {
    code: "23514",
    message: "Athletes under 18 need a parent or guardian email on file",
  };

  it("with apiContract, the DB age rule (23514) is 422 unprocessable with the sign-up message", async () => {
    const admin = fakeClient({ athletes: { id: "a1" } }, { updateError: ageRule });
    const err = await caughtAny(() =>
      updateAthleteSelf({ userId: "u", admin }, input, { apiContract: true }),
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
    expect((err as ApiError).code).toBe("unprocessable");
    expect((err as ApiError).message).toBe(UNDER_18_NEEDS_GUARDIAN);
  });

  it("without apiContract (the web), the same failure stays the generic plain error", async () => {
    const admin = fakeClient({ athletes: { id: "a1" } }, { updateError: ageRule });
    const err = await caughtAny(() => updateAthleteSelf({ userId: "u", admin }, input));
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ApiError);
    expect((err as Error).message).toBe("Something went wrong. Please try again.");
  });
});
