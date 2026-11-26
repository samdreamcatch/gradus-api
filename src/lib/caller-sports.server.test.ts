import { describe, expect, it } from "bun:test";
import { callerSports } from "./caller-sports.server";

const guarded = async () => [
  { athleteId: "a1", locked: false },
  { athleteId: "a2", locked: true },
];

/** Every query resolves to the rows given for its table; records the filters. */
function fakeAdmin(rows: Record<string, { sport: string }[]>) {
  const calls: { table: string; filter: string; value: unknown }[] = [];
  const chain = (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self: any = {};
    self.select = () => self;
    self.eq = (col: string, value: unknown) => (
      calls.push({ table, filter: `eq:${col}`, value }),
      self
    );
    self.in = (col: string, value: unknown) => (
      calls.push({ table, filter: `in:${col}`, value }),
      self
    );
    self.then = (resolve: (v: unknown) => void) =>
      resolve({ data: rows[table] ?? [], error: null });
    return self;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: { from: (table: string) => chain(table) } as any, calls };
}

describe("callerSports", () => {
  it("reads a coach's levels, sorted and de-duplicated", async () => {
    const fake = fakeAdmin({
      coach_levels: [{ sport: "tennis" }, { sport: "figure_skating" }, { sport: "tennis" }],
    });
    expect(await callerSports(fake.admin, { role: "coach", coachId: "c1" })).toEqual([
      "figure_skating",
      "tennis",
    ]);
    expect(fake.calls).toEqual([{ table: "coach_levels", filter: "eq:coach_id", value: "c1" }]);
  });

  it("unions an athlete's goal and coached sports", async () => {
    const fake = fakeAdmin({
      athlete_goals: [{ sport: "golf" }],
      coach_athlete_sports: [{ sport: "figure_skating" }, { sport: "golf" }],
    });
    expect(await callerSports(fake.admin, { role: "athlete", athleteId: "a9" })).toEqual([
      "figure_skating",
      "golf",
    ]);
  });

  it("uses a coach's levels when the caller already read them: no request", async () => {
    const fake = fakeAdmin({ coach_levels: [{ sport: "never_read" }] });
    expect(
      await callerSports(fake.admin, {
        role: "coach",
        coachId: "c1",
        levels: [{ sport: "tennis" }, { sport: "figure_skating" }, { sport: "tennis" }],
      }),
    ).toEqual(["figure_skating", "tennis"]);
    expect(await callerSports(fake.admin, { role: "coach", coachId: "c1", levels: [] })).toEqual(
      [],
    );
    expect(fake.calls).toEqual([]);
  });

  it("reads a coach's levels when the caller passed none (null or missing)", async () => {
    const fake = fakeAdmin({ coach_levels: [{ sport: "golf" }] });
    expect(await callerSports(fake.admin, { role: "coach", coachId: "c1", levels: null })).toEqual([
      "golf",
    ]);
    expect(fake.calls).toEqual([{ table: "coach_levels", filter: "eq:coach_id", value: "c1" }]);
  });

  it("uses an athlete's coached sports when the caller already read them: only the goals are read", async () => {
    const fake = fakeAdmin({
      athlete_goals: [{ sport: "golf" }],
      coach_athlete_sports: [{ sport: "never_read" }],
    });
    expect(
      await callerSports(fake.admin, {
        role: "athlete",
        athleteId: "a9",
        coachSports: [{ sport: "figure_skating" }, { sport: "golf" }],
      }),
    ).toEqual(["figure_skating", "golf"]);
    expect(fake.calls).toEqual([
      { table: "athlete_goals", filter: "in:athlete_id", value: ["a9"] },
    ]);
  });

  it("reads both of an athlete's tables when the caller passed none", async () => {
    const fake = fakeAdmin({
      athlete_goals: [{ sport: "golf" }],
      coach_athlete_sports: [{ sport: "hockey" }],
    });
    expect(
      await callerSports(fake.admin, { role: "athlete", athleteId: "a9", coachSports: null }),
    ).toEqual(["golf", "hockey"]);
    expect(fake.calls.map((c) => c.table)).toEqual(["athlete_goals", "coach_athlete_sports"]);
  });

  it("covers every athlete a parent guards, locked ones included", async () => {
    const fake = fakeAdmin({ athlete_goals: [{ sport: "figure_skating" }] });
    expect(await callerSports(fake.admin, { role: "parent", parentId: "p1" }, guarded)).toEqual([
      "figure_skating",
    ]);
    expect(fake.calls.find((c) => c.table === "athlete_goals")?.value).toEqual(["a1", "a2"]);
  });

  it("is empty without a profile", async () => {
    expect(await callerSports(fakeAdmin({}).admin, { role: "none" })).toEqual([]);
  });
});
