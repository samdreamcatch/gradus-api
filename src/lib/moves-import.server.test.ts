import { describe, expect, it } from "bun:test";
import { importMoves, importMovesInput, MAX_IMPORT_MOVES, type MovesContext } from "./moves.server";

/* A minimal Supabase-shaped fake: just the chains importMoves uses. */
type Row = Record<string, any>;

function fakeSupabase(seed: { coach_profiles: Row[]; moves: Row[] }) {
  const tables: Record<string, Row[]> = {
    coach_profiles: seed.coach_profiles.map((r) => ({ ...r })),
    moves: seed.moves.map((r) => ({ ...r })),
  };
  let ids = 0;
  const calls = { inserts: 0, updates: 0 };

  function from(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let mode: "select" | "insert" | "update" = "select";
    let payload: Row | Row[] | null = null;
    const run = () => {
      const rows = tables[table];
      if (mode === "insert") {
        calls.inserts += 1;
        const arr = (payload as Row[]).map((r) => ({
          id: `new_${++ids}`,
          archived_at: null,
          ...r,
        }));
        rows.push(...arr);
        return { data: arr, error: null };
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (mode === "update") {
        calls.updates += 1;
        for (const r of hit) Object.assign(r, payload);
      }
      return { data: hit, error: null };
    };
    const b: any = {
      select: () => b,
      insert: (p: Row[]) => ((mode = "insert"), (payload = p), b),
      update: (p: Row) => ((mode = "update"), (payload = p), b),
      eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), b),
      is: (col: string, v: unknown) => (filters.push((r) => (r[col] ?? null) === v), b),
      maybeSingle: async () => {
        const { data, error } = run();
        return { data: data[0] ?? null, error };
      },
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return b;
  }
  return { client: { from } as unknown as MovesContext["supabase"], tables, calls };
}

const base = {
  sport: "figure_skating",
  category: "Jumps",
  description: "",
  cue: "",
  why: "",
  defaultTargetKind: "reps" as const,
  defaultTargetValue: 10,
};

function setup(existing: Row[] = []) {
  const fake = fakeSupabase({
    coach_profiles: [{ id: "coach-1", user_id: "user-1" }],
    moves: existing.map((m) => ({ coach_id: "coach-1", archived_at: null, ...m })),
  });
  return { ...fake, ctx: { userId: "user-1", supabase: fake.client } };
}

describe("importMoves", () => {
  it("creates new moves in one insert and reports each by request index", async () => {
    const { ctx, tables, calls } = setup();
    const input = importMovesInput.parse({
      moves: [
        { ...base, name: "Waltz jump" },
        { ...base, name: "  Salchow ", category: " Jumps " },
      ],
    });
    const res = await importMoves(ctx, input);
    expect(calls.inserts).toBe(1);
    expect(res.created).toBe(2);
    expect(res.results.map((r) => [r.index, r.name, r.status])).toEqual([
      [0, "Waltz jump", "created"],
      [1, "Salchow", "created"],
    ]);
    expect(res.results.every((r) => r.moveId)).toBe(true);
    const salchow = tables.moves.find((m) => m.name === "Salchow")!;
    expect(salchow.category).toBe("Jumps");
    expect(salchow.coach_id).toBe("coach-1");
    expect(salchow.default_target_value).toBe(10);
  });

  it("skips a name already in the library by default, case-insensitively", async () => {
    const { ctx, tables, calls } = setup([{ id: "m1", name: "Waltz Jump", cue: "old" }]);
    const res = await importMoves(
      ctx,
      importMovesInput.parse({ moves: [{ ...base, name: "waltz jump", cue: "new" }] }),
    );
    expect(res.results[0]).toEqual({
      index: 0,
      name: "waltz jump",
      status: "skipped",
      reason: "name_exists",
      moveId: "m1",
    });
    expect(calls.inserts + calls.updates).toBe(0);
    expect(tables.moves[0].cue).toBe("old");
  });

  it("overwrites the existing move in place when asked, keeping its id", async () => {
    const { ctx, tables } = setup([{ id: "m1", name: "Waltz Jump", cue: "old" }]);
    const res = await importMoves(
      ctx,
      importMovesInput.parse({
        moves: [{ ...base, name: "Waltz Jump", cue: "new", onConflict: "overwrite" }],
      }),
    );
    expect(res.updated).toBe(1);
    expect(res.results[0].moveId).toBe("m1");
    expect(tables.moves).toHaveLength(1);
    expect(tables.moves[0].cue).toBe("new");
  });

  it("archived moves don't count as conflicts", async () => {
    const { ctx } = setup([{ id: "m1", name: "Axel", archived_at: "2026-01-01T00:00:00Z" }]);
    const res = await importMoves(
      ctx,
      importMovesInput.parse({ moves: [{ ...base, name: "Axel" }] }),
    );
    expect(res.created).toBe(1);
  });

  it("keeps only the first of a name repeated inside the file", async () => {
    const { ctx } = setup();
    const res = await importMoves(
      ctx,
      importMovesInput.parse({
        moves: [
          { ...base, name: "Spiral" },
          { ...base, name: "SPIRAL", onConflict: "overwrite" },
        ],
      }),
    );
    expect(res.created).toBe(1);
    expect(res.results[1]).toMatchObject({
      index: 1,
      status: "skipped",
      reason: "duplicate_in_file",
    });
  });

  it("rejects an empty or oversized batch and defaults onConflict to skip", () => {
    expect(importMovesInput.safeParse({ moves: [] }).success).toBe(false);
    const big = Array.from({ length: MAX_IMPORT_MOVES + 1 }, (_, i) => ({
      ...base,
      name: `M${i}`,
    }));
    expect(importMovesInput.safeParse({ moves: big }).success).toBe(false);
    expect(importMovesInput.parse({ moves: [{ ...base, name: "A" }] }).moves[0].onConflict).toBe(
      "skip",
    );
  });
});
