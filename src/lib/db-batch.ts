/**
 * Reading and filtering at squad size.
 *
 * Two limits sit between this code and the database, and neither reports an
 * error when it is crossed in the common case:
 *
 *  - PostgREST answers with at most a fixed number of rows (1,000 unless the
 *    project raises it) and silently drops the rest. `readAll` pages through
 *    a query until it has every row.
 *  - An `in (...)` filter travels in the URL. A few hundred UUIDs is several
 *    kilobytes, past what a gateway accepts. `chunks` cuts an id list into
 *    pieces that stay well inside it.
 *
 * Anything that reads "every copy of a plan" or "every move of these plans"
 * goes through both.
 */

/** About 3.7 KB of UUIDs in the URL. */
export const IN_CHUNK = 100;
/** PostgREST's default row cap; a page is never asked for more. */
export const PAGE_ROWS = 1000;

export function chunks<T>(items: readonly T[], size: number = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type Page<T> = {
  data: T[] | null;
  error: { message?: string; code?: string } | null;
  count?: number | null;
};

/**
 * Every row of a query. `page(from, to)` must apply a stable, total order
 * (end with the primary key) and `.range(from, to)`, and should select with
 * `{ count: "exact" }` so a server whose cap is below `PAGE_ROWS` is still
 * read to the end. Throws the first error it meets.
 */
export async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<Page<T>>,
  onError: (error: { message?: string; code?: string }) => never,
): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const res = await page(rows.length, rows.length + PAGE_ROWS - 1);
    // Rows deleted while paging can leave the next page starting past the
    // end, which PostgREST answers with "range not satisfiable": that is the end.
    if (res.error?.code === "PGRST103") return rows;
    if (res.error) onError(res.error);
    const got = res.data ?? [];
    rows.push(...got);
    if (!got.length) return rows;
    if (typeof res.count === "number") {
      if (rows.length >= res.count) return rows;
    } else if (got.length < PAGE_ROWS) {
      return rows;
    }
  }
}

/** Runs `task` over `items`, at most `limit` at a time, in order of arrival. */
export async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<unknown>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
