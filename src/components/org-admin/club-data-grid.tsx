import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Group, SlidersHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ClubTable } from "@/components/org-admin/club-table";
import { ClubEmptyRow, ClubGroupRow } from "@/components/org-admin/club-grid-toolbar";
import {
  EMPTY_PREFS,
  groupRows,
  nextSort,
  parsePrefs,
  sortRows,
  visibleKeys,
  type GridPrefs,
  type SortValue,
} from "@/lib/club-grid";
import { cn } from "@/lib/utils";

export type ClubColumn<T> = {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  /** Value used to sort; omit to make the column unsortable. */
  sortValue?: (row: T) => SortValue;
  /** Label used to group; omit to keep the column out of "Group by". */
  groupValue?: (row: T) => string | null | undefined;
  align?: "right";
  className?: string;
  footer?: (rows: T[]) => ReactNode;
  /** Hidden until the admin turns it on. */
  defaultHidden?: boolean;
};

const STORAGE_PREFIX = "gradus.club-grid.";

/** Device-saved field visibility, sort and grouping for one club grid. */
export function useClubGrid<T>(
  storageKey: string,
  columns: ClubColumn<T>[],
  rows: T[],
  opts: { group?: string } = {},
) {
  const keys = columns.map((c) => c.key);
  const groupable = columns.filter((c) => c.groupValue).map((c) => c.key);
  const defaults: GridPrefs = {
    ...EMPTY_PREFS,
    group: opts.group ?? null,
    hidden: columns.filter((c) => c.defaultHidden).map((c) => c.key),
  };
  const [prefs, setPrefsState] = useState<GridPrefs>(defaults);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_PREFIX + storageKey);
    if (raw) setPrefsState(parsePrefs(raw, keys, groupable));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const setPrefs = (next: GridPrefs) => {
    setPrefsState(next);
    try {
      localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };

  const byKey = new Map(columns.map((c) => [c.key, c]));
  const shown = visibleKeys(keys, prefs.hidden).map((k) => byKey.get(k)!);
  const sorted = useMemo(
    () => sortRows(rows, prefs.sort, (r, k) => byKey.get(k)?.sortValue?.(r)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, prefs.sort, columns],
  );
  const groupCol = prefs.group ? byKey.get(prefs.group) : undefined;
  const groups = groupCol?.groupValue ? groupRows(sorted, groupCol.groupValue) : null;
  const changed =
    prefs.hidden.join() !== defaults.hidden.join() || !!prefs.sort || prefs.group !== defaults.group;

  const menu = (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="press-soft">
            <Columns3 className="size-3.5" />
            Fields
            {prefs.hidden.length > 0 && (
              <span className="font-mono text-xs text-text-secondary">
                {prefs.hidden.length} hidden
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Show fields</DropdownMenuLabel>
          {columns.map((c, i) => (
            <DropdownMenuCheckboxItem
              key={c.key}
              disabled={i === 0}
              checked={i === 0 || !prefs.hidden.includes(c.key)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(on) =>
                setPrefs({
                  ...prefs,
                  hidden: on ? prefs.hidden.filter((k) => k !== c.key) : [...prefs.hidden, c.key],
                })
              }
            >
              {c.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="press-soft">
            <SlidersHorizontal className="size-3.5" />
            Sort
            {prefs.sort && (
              <span className="text-xs text-text-secondary">
                {byKey.get(prefs.sort.key)?.label} {prefs.sort.dir === "asc" ? "↑" : "↓"}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={prefs.sort?.key ?? "none"}
            onValueChange={(k) =>
              setPrefs({
                ...prefs,
                sort: k === "none" ? null : { key: k, dir: prefs.sort?.dir ?? "asc" },
              })
            }
          >
            <DropdownMenuRadioItem value="none">Default order</DropdownMenuRadioItem>
            {columns
              .filter((c) => c.sortValue)
              .map((c) => (
                <DropdownMenuRadioItem key={c.key} value={c.key}>
                  {c.label}
                </DropdownMenuRadioItem>
              ))}
          </DropdownMenuRadioGroup>
          {prefs.sort && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={prefs.sort.dir}
                onValueChange={(d) =>
                  setPrefs({ ...prefs, sort: { key: prefs.sort!.key, dir: d as "asc" | "desc" } })
                }
              >
                <DropdownMenuRadioItem value="asc">Ascending</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="desc">Descending</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {groupable.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="press-soft">
              <Group className="size-3.5" />
              Group
              {groupCol && <span className="text-xs text-text-secondary">{groupCol.label}</span>}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Group by</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={prefs.group ?? "none"}
              onValueChange={(k) => setPrefs({ ...prefs, group: k === "none" ? null : k })}
            >
              <DropdownMenuRadioItem value="none">No grouping</DropdownMenuRadioItem>
              {groupable.map((k) => (
                <DropdownMenuRadioItem key={k} value={k}>
                  {byKey.get(k)!.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {changed && (
        <Button variant="link" size="sm" onClick={() => setPrefs(defaults)}>
          Reset view
        </Button>
      )}
    </div>
  );

  return {
    prefs,
    columns: shown,
    rows: sorted,
    groups,
    menu,
    toggleSort: (key: string) => setPrefs({ ...prefs, sort: nextSort(prefs.sort, key) }),
  };
}

export type ClubGridState<T> = ReturnType<typeof useClubGrid<T>>;

/** Airtable-style grid: sticky header and first column, clickable sort headers, groups. */
export function ClubDataGrid<T>({
  grid,
  rowKey,
  onRowClick,
  rowLabel,
  empty,
  filtered,
  onClear,
  showFooter,
  className,
}: {
  grid: ClubGridState<T>;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowLabel?: (row: T) => string;
  empty: ReactNode;
  filtered: boolean;
  onClear?: () => void;
  showFooter?: boolean;
  className?: string;
}) {
  const cols = grid.columns;
  const renderRow = (row: T) => (
    <TableRow
      key={rowKey(row)}
      className={cn(onRowClick && "cursor-pointer")}
      tabIndex={onRowClick ? 0 : undefined}
      aria-label={onRowClick && rowLabel ? `Open ${rowLabel(row)}` : undefined}
      onClick={onRowClick ? () => onRowClick(row) : undefined}
      onKeyDown={
        onRowClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onRowClick(row);
              }
            }
          : undefined
      }
    >
      {cols.map((c, i) => (
        <TableCell
          key={c.key}
          className={cn(
            c.align === "right" && "text-right font-mono tabular-nums",
            i === 0 && "sticky left-0 z-[1] bg-card font-medium text-text-primary",
            c.className,
          )}
        >
          {c.render(row)}
        </TableCell>
      ))}
    </TableRow>
  );

  return (
    <div className={cn("max-h-[70vh] overflow-auto rounded-md", className)}>
      <ClubTable className="[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-[2]">
        <TableHeader>
          <TableRow>
            {cols.map((c, i) => {
              const active = grid.prefs.sort?.key === c.key ? grid.prefs.sort.dir : null;
              return (
                <TableHead
                  key={c.key}
                  aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : undefined}
                  className={cn(
                    "whitespace-nowrap",
                    c.align === "right" && "text-right",
                    i === 0 && "sticky left-0 z-[3]",
                  )}
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      onClick={() => grid.toggleSort(c.key)}
                      className={cn(
                        "press-soft inline-flex min-h-9 items-center gap-1 font-semibold",
                        c.align === "right" && "flex-row-reverse",
                      )}
                    >
                      {c.label}
                      {active === "asc" ? (
                        <ArrowUp className="size-3" />
                      ) : active === "desc" ? (
                        <ArrowDown className="size-3" />
                      ) : (
                        <ArrowUpDown className="size-3 text-text-tertiary" />
                      )}
                    </button>
                  ) : (
                    c.label
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {grid.groups
            ? grid.groups.flatMap((g) => [
                <ClubGroupRow key={`g-${g.label}`} label={g.label} count={g.rows.length} colSpan={cols.length} />,
                ...g.rows.map(renderRow),
              ])
            : grid.rows.map(renderRow)}
          {!grid.rows.length && (
            <ClubEmptyRow colSpan={cols.length} filtered={filtered} empty={empty} onClear={onClear} />
          )}
        </TableBody>
        {showFooter && grid.rows.length > 0 && (
          <TableFooter>
            <TableRow>
              {cols.map((c, i) => (
                <TableCell
                  key={c.key}
                  className={cn(
                    c.align === "right" && "text-right font-mono tabular-nums",
                    i === 0 && "sticky left-0 bg-elevated",
                  )}
                >
                  {c.footer ? c.footer(grid.rows) : i === 0 ? `${grid.rows.length} records` : null}
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        )}
      </ClubTable>
    </div>
  );
}
