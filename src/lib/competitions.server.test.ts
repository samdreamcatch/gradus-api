import { describe, expect, it } from "bun:test";
import { recordAttendance } from "./competitions.server";

/**
 * In-memory fake of the loose admin client for the shapes attendance uses:
 * `.from(t).select().eq()...maybeSingle()`, `.select().eq()` / `.in()` lists
 * (awaited directly), and `.insert()`. Test-only.
 */
function fakeAdmin(tables: Record<string, Record<string, unknown>[]>) {
  const inserted: Record<string, Record<string, unknown>[]> = {};
  function rows(table: string) {
    if (!tables[table]) tables[table] = [];
    return tables[table];
  }
  function query(table: string, filters: Array<(row: Record<string, unknown>) => boolean>) {
    const matches = () => rows(table).filter((row) => filters.every((f) => f(row)));
    const chain = {
      select: () => chain,
      eq: (c: string, v: unknown) => query(table, [...filters, (r) => r[c] === v]),
      in: (c: string, vs: unknown[]) => query(table, [...filters, (r) => vs.includes(r[c])]),
      maybeSingle: async () => ({ data: matches()[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: matches(), error: null }).then(resolve),
    };
    return chain;
  }
  return {
    inserted,
    admin: {
      from: (table: string) => ({
        ...query(table, []),
        insert: async (row: Record<string, unknown>) => {
          (inserted[table] ??= []).push(row);
          rows(table).push(row);
          return { error: null };
        },
      }),
    },
  };
}

const COMP = { id: "c1", slug: "skate-detroit" };

describe("recordAttendance", () => {
  it("records a parent with their single figure-skating athlete attached, by slug or by id", async () => {
    const { admin, inserted } = fakeAdmin({
      parent_profiles: [{ id: "p1", user_id: "u1", first_name: "Pat", last_name: "Lee" }],
      athletes: [{ id: "a1", parent_id: "p1", first_name: "Ava", last_name: "Lee" }],
      athlete_guardians: [],
      coach_athlete_sports: [{ athlete_id: "a1", sport: "figure_skating" }],
      competitions: [COMP],
      competition_attendance: [],
    });
    expect(await recordAttendance(admin, "u1", { slug: "skate-detroit" })).toEqual({ ok: true });
    expect(inserted.competition_attendance).toEqual([
      { user_id: "u1", competition_id: "c1", athlete_id: "a1", viewer_role: "parent" },
    ]);
    // Second call, by id this time: already recorded, nothing inserted.
    expect(await recordAttendance(admin, "u1", { id: "c1" })).toEqual({ ok: true });
    expect(inserted.competition_attendance?.length).toBe(1);
  });

  it("records a coach without an athlete; refuses an account with no profile", async () => {
    const { admin, inserted } = fakeAdmin({
      parent_profiles: [],
      athletes: [],
      coach_profiles: [{ id: "co1", user_id: "coach" }],
      competitions: [COMP],
      competition_attendance: [],
    });
    expect(await recordAttendance(admin, "coach", { id: "c1" })).toEqual({ ok: true });
    expect(inserted.competition_attendance).toEqual([
      { user_id: "coach", competition_id: "c1", athlete_id: null, viewer_role: "coach" },
    ]);
    expect(await recordAttendance(admin, "nobody", { id: "c1" })).toEqual({ ok: false });
    expect(inserted.competition_attendance?.length).toBe(1);
  });

  it("returns ok: false for an unknown competition and leaves the athlete open when ambiguous", async () => {
    const { admin, inserted } = fakeAdmin({
      parent_profiles: [{ id: "p1", user_id: "u1", first_name: "Pat", last_name: "Lee" }],
      athletes: [
        { id: "a1", parent_id: "p1", first_name: "Ava", last_name: "Lee" },
        { id: "a2", parent_id: "p1", first_name: "Bo", last_name: "Lee" },
      ],
      athlete_guardians: [],
      coach_athlete_sports: [
        { athlete_id: "a1", sport: "figure_skating" },
        { athlete_id: "a2", sport: "figure_skating" },
      ],
      competitions: [COMP],
      competition_attendance: [],
    });
    expect(await recordAttendance(admin, "u1", { id: "missing" })).toEqual({ ok: false });
    expect(await recordAttendance(admin, "u1", { slug: "skate-detroit" })).toEqual({ ok: true });
    expect(inserted.competition_attendance?.[0]?.athlete_id).toBeNull();
  });
});
