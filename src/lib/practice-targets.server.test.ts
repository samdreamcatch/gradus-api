import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import { clearPracticeTarget, setPracticeTarget } from "./practice-targets.server";

type Write = { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> };

/**
 * A chainable fake: `rows[table]` answers `maybeSingle` (a missing key is `null`), `opts.writes`
 * records every upsert/delete with its payload and `eq` filters, and `opts.errors["table.op"]`
 * makes that write come back with the error.
 */
function fakeClient(
  rows: Record<string, unknown | null>,
  opts: { writes?: Write[]; errors?: Record<string, { code: string; message: string }> } = {},
) {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    const filters: Array<[string, unknown]> = [];
    let write: Write | null = null;
    self.select = () => self;
    self.eq = (column: string, value: unknown) => {
      filters.push([column, value]);
      return self;
    };
    for (const op of ["upsert", "delete"]) {
      self[op] = (payload?: unknown) => {
        write = { table, op, payload, filters };
        opts.writes?.push(write);
        return self;
      };
    }
    self.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
    self.then = (resolve: (v: unknown) => void) =>
      resolve({
        data: null,
        error: write ? (opts.errors?.[`${table}.${write.op}`] ?? null) : null,
      });
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

const coach = { coach_profiles: { id: "coach-1" } };
/** The coach has athlete `a1` on their roster; any other athlete id reads as not rostered. */
const roster = { coach_athletes: { athlete_id: "a1" } };
const target = { sport: "figure_skating", hoursPerWeek: 5 };
const now = new Date("2026-10-05T12:00:00.000Z");

describe("setPracticeTarget stays on the coach's roster", () => {
  it("an athlete not on the roster is 403 and writes nothing", async () => {
    const writes: Write[] = [];
    const supabase = fakeClient({ ...coach }, { writes });
    const err = await caught(() =>
      setPracticeTarget({ userId: "u", supabase }, "a-stranger", target, now),
    );
    expect(err?.status).toBe(403);
    expect(err?.code).toBe("forbidden");
    expect(err?.message).toBe("Athlete is not on your roster");
    expect(writes).toEqual([]);
  });

  it("an athlete on the roster gets the upsert, keyed on (coach, athlete, sport)", async () => {
    const writes: Write[] = [];
    const supabase = fakeClient({ ...coach, ...roster }, { writes });
    await expect(setPracticeTarget({ userId: "u", supabase }, "a1", target, now)).resolves.toEqual({
      ok: true,
    });
    expect(writes).toEqual([
      {
        table: "coach_athlete_practice_targets",
        op: "upsert",
        payload: {
          coach_id: "coach-1",
          athlete_id: "a1",
          sport: "figure_skating",
          hours_per_week: 5,
          updated_at: "2026-10-05T12:00:00.000Z",
        },
        filters: [],
      },
    ]);
  });

  it("the roster is looked up for this coach and this athlete", async () => {
    const writes: Write[] = [];
    const rosterFilters: Array<[string, unknown]> = [];
    const base = fakeClient({ ...coach, ...roster }, { writes });
    const supabase = {
      from: (table: string) => {
        const q = base.from(table);
        if (table !== "coach_athletes") return q;
        const eq = q.eq;
        q.eq = (column: string, value: unknown) => {
          rosterFilters.push([column, value]);
          return eq(column, value);
        };
        return q;
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await setPracticeTarget({ userId: "u", supabase: supabase as any }, "a1", target, now);
    expect(rosterFilters).toEqual([
      ["coach_id", "coach-1"],
      ["athlete_id", "a1"],
    ]);
  });

  it("the database's refusal (the roster policy, if it ever disagrees) is the same 403", async () => {
    const supabase = fakeClient(
      { ...coach, ...roster },
      {
        errors: {
          "coach_athlete_practice_targets.upsert": {
            code: "42501",
            message:
              'new row violates row-level security policy for table "coach_athlete_practice_targets"',
          },
        },
      },
    );
    const err = await caught(() => setPracticeTarget({ userId: "u", supabase }, "a1", target, now));
    expect(err?.status).toBe(403);
    expect(err?.message).toBe("Athlete is not on your roster");
  });

  it("any other database error stays a generic failure, not a roster answer", async () => {
    const supabase = fakeClient(
      { ...coach, ...roster },
      { errors: { "coach_athlete_practice_targets.upsert": { code: "XX000", message: "boom" } } },
    );
    const original = console.error;
    console.error = () => {};
    try {
      await expect(setPracticeTarget({ userId: "u", supabase }, "a1", target, now)).rejects.toThrow(
        "Something went wrong. Please try again.",
      );
    } finally {
      console.error = original;
    }
  });

  it("a caller with no coach profile is 422", async () => {
    const supabase = fakeClient({});
    const err = await caught(() => setPracticeTarget({ userId: "u", supabase }, "a1", target, now));
    expect(err?.status).toBe(422);
    expect(err?.message).toBe("Coach profile not found");
  });
});

describe("clearPracticeTarget", () => {
  it("clears the coach's own target without a roster check, so a coach can tidy up after an athlete leaves", async () => {
    const writes: Write[] = [];
    const supabase = fakeClient({ ...coach }, { writes });
    await expect(
      clearPracticeTarget({ userId: "u", supabase }, "a-left", "figure_skating"),
    ).resolves.toEqual({ ok: true });
    expect(writes).toEqual([
      {
        table: "coach_athlete_practice_targets",
        op: "delete",
        payload: undefined,
        filters: [
          ["coach_id", "coach-1"],
          ["athlete_id", "a-left"],
          ["sport", "figure_skating"],
        ],
      },
    ]);
  });
});
