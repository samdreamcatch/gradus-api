import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type ClubGridView = { value: string; label: string; icon?: ReactNode };

/** One toolbar for every club "database" page: view switch, search, filters, active-filter count. */
export function ClubGridToolbar({
  views,
  view,
  onViewChange,
  search,
  onSearchChange,
  searchLabel = "Search",
  activeFilters = 0,
  onClear,
  children,
  end,
}: {
  views?: ClubGridView[];
  view?: string;
  onViewChange?: (v: string) => void;
  search?: string;
  onSearchChange?: (v: string) => void;
  searchLabel?: string;
  activeFilters?: number;
  onClear?: () => void;
  children?: ReactNode;
  end?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 font-sans [&_button]:min-h-11">
      {views && views.length > 1 && (
        <>
          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(v) => v && onViewChange?.(v)}
            aria-label="View"
          >
            {views.map((v) => (
              <ToggleGroupItem key={v.value} value={v.value} className="min-h-11 press-soft px-3 font-sans">
                {v.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <span className="mx-1 h-6 w-px bg-divider" aria-hidden />
        </>
      )}
      {onSearchChange && (
        <div className="relative w-full sm:w-72">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary"
            aria-hidden
          />
          <Input
            aria-label={searchLabel}
            placeholder={searchLabel}
            value={search ?? ""}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-11 border-border-strong pl-9 font-sans"
          />
        </div>
      )}
      {children}
      {activeFilters > 0 && onClear && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear · {activeFilters}
        </Button>
      )}
      {end && <div className="ml-auto flex flex-wrap items-center gap-2">{end}</div>}
    </div>
  );
}

/** Record count line under a grid ("12 of 40 records"). */
export function ClubGridCount({
  shown,
  total,
  noun = "records",
  className,
}: {
  shown: number;
  total: number;
  noun?: string;
  className?: string;
}) {
  return (
    <p className={cn("font-mono text-xs tabular-nums text-text-secondary", className)}>
      {shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`}
    </p>
  );
}

/** Collapsible-looking group header row inside a ClubTable body. */
export function ClubGroupRow({
  label,
  count,
  colSpan,
}: {
  label: ReactNode;
  count: number;
  colSpan: number;
}) {
  return (
    <TableRow className="club-group-row">
      <TableCell
        colSpan={colSpan}
        className="py-2! text-sm text-text-secondary"
      >
        <span className="font-semibold text-text-primary">{label}</span>
        <span className="ml-2 font-mono">{count}</span>
      </TableCell>
    </TableRow>
  );
}

/** Empty / no-match row for ClubTable. */
export function ClubEmptyRow({
  colSpan,
  filtered,
  empty,
  onClear,
}: {
  colSpan: number;
  filtered: boolean;
  empty: ReactNode;
  onClear?: () => void;
}) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-10 text-center text-text-secondary">
        {filtered ? (
          <>
            No records match these filters.
            {onClear && (
              <Button variant="link" size="sm" onClick={onClear}>
                Clear filters
              </Button>
            )}
          </>
        ) : (
          empty
        )}
      </TableCell>
    </TableRow>
  );
}
