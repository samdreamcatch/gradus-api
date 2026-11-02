/** Pure sort/group/visibility rules shared by every club admin grid. */

export type SortDir = "asc" | "desc";
export type GridSort = { key: string; dir: SortDir } | null;

export type GridPrefs = {
  hidden: string[];
  sort: GridSort;
  group: string | null;
};

export const EMPTY_PREFS: GridPrefs = { hidden: [], sort: null, group: null };

export type SortValue = string | number | boolean | null | undefined;

function compare(a: SortValue, b: SortValue): number {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  // Empty values always sink to the bottom, whatever the direction.
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function sortRows<T>(
  rows: T[],
  sort: GridSort,
  valueOf: (row: T, key: string) => SortValue,
): T[] {
  if (!sort) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i }))
    .sort((x, y) => {
      const a = valueOf(x.row, sort.key);
      const b = valueOf(y.row, sort.key);
      const aEmpty = a === null || a === undefined || a === "";
      const bEmpty = b === null || b === undefined || b === "";
      if (aEmpty || bEmpty) return compare(a, b) || x.i - y.i;
      return sign * compare(a, b) || x.i - y.i;
    })
    .map((x) => x.row);
}

export type RowGroup<T> = { label: string; rows: T[] };

/** Groups in first-seen order after sorting; blank labels collect under "None". */
export function groupRows<T>(
  rows: T[],
  labelOf: (row: T) => string | null | undefined,
): RowGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const label = labelOf(row)?.trim() || "None";
    const list = map.get(label);
    if (list) list.push(row);
    else map.set(label, [row]);
  }
  const groups = [...map.entries()].map(([label, list]) => ({ label, rows: list }));
  const none = groups.findIndex((g) => g.label === "None");
  if (none >= 0) groups.push(...groups.splice(none, 1));
  return groups;
}

/** The first column can never be hidden, so a record always has a name. */
export function visibleKeys(allKeys: string[], hidden: string[]): string[] {
  return allKeys.filter((k, i) => i === 0 || !hidden.includes(k));
}

/** Clicking a column header cycles ascending → descending → off. */
export function nextSort(current: GridSort, key: string): GridSort {
  if (!current || current.key !== key) return { key, dir: "asc" };
  if (current.dir === "asc") return { key, dir: "desc" };
  return null;
}

export function parsePrefs(raw: string | null, allKeys: string[], groupable: string[]): GridPrefs {
  if (!raw) return EMPTY_PREFS;
  try {
    const p = JSON.parse(raw) as Partial<GridPrefs>;
    const hidden = Array.isArray(p.hidden) ? p.hidden.filter((k) => allKeys.includes(k)) : [];
    const sort =
      p.sort && allKeys.includes(p.sort.key) && (p.sort.dir === "asc" || p.sort.dir === "desc")
        ? { key: p.sort.key, dir: p.sort.dir }
        : null;
    const group = p.group && groupable.includes(p.group) ? p.group : null;
    return { hidden, sort, group };
  } catch {
    return EMPTY_PREFS;
  }
}
