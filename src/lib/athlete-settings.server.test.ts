import { describe, expect, it } from "bun:test";
import { athleteSelfInput, getAthleteSettings, updateAthleteSelf } from "./athlete-settings.server";

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
  it("answers ok", async () => {
    expect(
      await updateAthleteSelf(
        { userId: "u", admin: fakeClient({}) },
        { firstName: "Rory", lastName: "Gilmore", birthdate: null },
      ),
    ).toEqual({ ok: true });
  });
});
