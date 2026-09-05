/**
 * `board_follows` CRUD, per docs/ios/PRD.md §6.9. Brand-new table and
 * feature — there is no existing server function to reproduce here,
 * unlike the rest of `src/lib/api/`.
 *
 * `board_follows` is not yet in the generated Supabase `Database` type
 * (that codegen runs separately and is out of scope here), so table
 * access is cast the same way `src/routes/api/public/board/refresh.ts`
 * already does for ad-hoc table access.
 */
import type { ApiContext } from "./auth";
import { ApiError } from "./errors";

// A delete/eq chain is awaitable at every step (like supabase-js's real
// query builders) — `.delete().eq(a).eq(b)` can be awaited directly, or
// extended with another `.eq(c)` first.
type DeleteChain = Promise<{ error: unknown }> & {
  eq: (column: string, value: string) => DeleteChain;
};

type BoardFollowsTable = {
  from: (table: "board_follows") => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        eq: (
          column: string,
          value: string,
        ) => Promise<{ data: { skater_name: string }[] | null; error: unknown }>;
      };
    };
    upsert: (
      rows: Array<{ user_id: string; competition_slug: string; skater_name: string }>,
      opts: { onConflict: string; ignoreDuplicates: boolean },
    ) => Promise<{ error: unknown }>;
    delete: () => DeleteChain;
  };
};

function internalError(context: string, error: unknown): ApiError {
  console.error(`[api] ${context}`, error);
  return new ApiError({
    code: "internal",
    status: 500,
    message: "Something went wrong. Please try again.",
  });
}

export async function listFollows(
  admin: ApiContext["admin"],
  userId: string,
  slug: string,
): Promise<string[]> {
  const { data, error } = await (admin as unknown as BoardFollowsTable)
    .from("board_follows")
    .select("skater_name")
    .eq("user_id", userId)
    .eq("competition_slug", slug);
  if (error) throw internalError("board follows list", error);
  return (data ?? []).map((row) => row.skater_name);
}

/** Replaces the caller's full follow set for one board (PUT semantics). */
export async function replaceFollows(
  admin: ApiContext["admin"],
  userId: string,
  slug: string,
  names: string[],
): Promise<string[]> {
  const table = (admin as unknown as BoardFollowsTable).from("board_follows");

  const { error: deleteError } = await table
    .delete()
    .eq("user_id", userId)
    .eq("competition_slug", slug);
  if (deleteError) throw internalError("board follows replace (clear)", deleteError);

  const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  if (unique.length === 0) return [];

  const { error: upsertError } = await table.upsert(
    unique.map((skaterName) => ({
      user_id: userId,
      competition_slug: slug,
      skater_name: skaterName,
    })),
    { onConflict: "user_id,competition_slug,skater_name", ignoreDuplicates: true },
  );
  if (upsertError) throw internalError("board follows replace (upsert)", upsertError);

  return unique;
}

export async function removeFollow(
  admin: ApiContext["admin"],
  userId: string,
  slug: string,
  name: string,
): Promise<void> {
  const { error } = await (admin as unknown as BoardFollowsTable)
    .from("board_follows")
    .delete()
    .eq("user_id", userId)
    .eq("competition_slug", slug)
    .eq("skater_name", name);
  if (error) throw internalError("board follows remove", error);
}
