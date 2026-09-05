import { describe, expect, it } from "bun:test";
import { listFollows, removeFollow, replaceFollows } from "./board-follows";
import type { ApiContext } from "./auth";

type FollowRow = { user_id: string; competition_slug: string; skater_name: string };

/**
 * A `.eq()` chain that is itself awaitable (like supabase-js's real query
 * builders) — `.delete().eq(a).eq(b)` can be awaited directly, or chained
 * with one more `.eq(c)` first. Lazy: a plain thenable, not a real Promise,
 * so building an intermediate (unawaited) chain link has no side effect —
 * only the actually-awaited link runs the delete, against whatever filters
 * were accumulated by that point.
 */
function deleteChain(rows: FollowRow[], filters: Array<[keyof FollowRow, string]> = []) {
  return {
    eq: (key: keyof FollowRow, value: string) => deleteChain(rows, [...filters, [key, value]]),
    then(resolve: (value: { error: null }) => void) {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (filters.every(([key, value]) => rows[i][key] === value)) rows.splice(i, 1);
      }
      resolve({ error: null });
    },
  };
}

function createFakeAdmin() {
  const rows: FollowRow[] = [];

  const admin = {
    from(table: string) {
      if (table !== "board_follows") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: (_c1: string, userId: string) => ({
            eq: async (_c2: string, slug: string) => ({
              data: rows.filter((r) => r.user_id === userId && r.competition_slug === slug),
              error: null,
            }),
          }),
        }),
        upsert: async (newRows: FollowRow[]) => {
          for (const row of newRows) {
            const exists = rows.some(
              (r) =>
                r.user_id === row.user_id &&
                r.competition_slug === row.competition_slug &&
                r.skater_name === row.skater_name,
            );
            if (!exists) rows.push(row);
          }
          return { error: null };
        },
        delete: () => deleteChain(rows),
      };
    },
  };

  return { admin: admin as unknown as ApiContext["admin"], rows };
}

describe("board-follows", () => {
  it("lists no follows initially", async () => {
    const { admin } = createFakeAdmin();
    expect(await listFollows(admin, "user-1", "worlds-2026")).toEqual([]);
  });

  it("replaces the follow set and lists it back", async () => {
    const { admin } = createFakeAdmin();
    const result = await replaceFollows(admin, "user-1", "worlds-2026", [
      "Skater A",
      "Skater B",
      "Skater A",
    ]);
    expect(result.sort()).toEqual(["Skater A", "Skater B"]);
    expect((await listFollows(admin, "user-1", "worlds-2026")).sort()).toEqual([
      "Skater A",
      "Skater B",
    ]);
  });

  it("removes one followed skater", async () => {
    const { admin } = createFakeAdmin();
    await replaceFollows(admin, "user-1", "worlds-2026", ["Skater A", "Skater B"]);
    await removeFollow(admin, "user-1", "worlds-2026", "Skater A");
    expect(await listFollows(admin, "user-1", "worlds-2026")).toEqual(["Skater B"]);
  });

  it("scopes follows per user and per board", async () => {
    const { admin } = createFakeAdmin();
    await replaceFollows(admin, "user-1", "worlds-2026", ["Skater A"]);
    await replaceFollows(admin, "user-2", "worlds-2026", ["Skater C"]);
    await replaceFollows(admin, "user-1", "nationals-2026", ["Skater D"]);

    expect(await listFollows(admin, "user-1", "worlds-2026")).toEqual(["Skater A"]);
    expect(await listFollows(admin, "user-2", "worlds-2026")).toEqual(["Skater C"]);
    expect(await listFollows(admin, "user-1", "nationals-2026")).toEqual(["Skater D"]);
  });

  it("replacing with an empty list clears follows for that board only", async () => {
    const { admin } = createFakeAdmin();
    await replaceFollows(admin, "user-1", "worlds-2026", ["Skater A"]);
    await replaceFollows(admin, "user-1", "nationals-2026", ["Skater D"]);
    await replaceFollows(admin, "user-1", "worlds-2026", []);

    expect(await listFollows(admin, "user-1", "worlds-2026")).toEqual([]);
    expect(await listFollows(admin, "user-1", "nationals-2026")).toEqual(["Skater D"]);
  });
});
