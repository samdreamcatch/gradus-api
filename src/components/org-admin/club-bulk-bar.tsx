import { useState, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import type { ClubColumn } from "@/components/org-admin/club-data-grid";

/** Row selection shared by club grids: a leading checkbox column plus a sticky action bar. */
export function useClubSelection<T>(rowKey: (row: T) => string, label: (row: T) => string) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (key: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const column: ClubColumn<T> = {
    key: "_select",
    label: "Select",
    className: "w-10",
    render: (row) => (
      <span onClick={(e) => e.stopPropagation()}>
        <Checkbox
          aria-label={`Select ${label(row)}`}
          checked={selected.has(rowKey(row))}
          onCheckedChange={(v) => toggle(rowKey(row), v === true)}
        />
      </span>
    ),
  };
  return {
    selected,
    column,
    clear: () => setSelected(new Set()),
    selectAll: (rows: T[]) => setSelected(new Set(rows.map(rowKey))),
    pick: (rows: T[]) => rows.filter((r) => selected.has(rowKey(r))),
  };
}

export function ClubBulkBar({
  count,
  total,
  onSelectAll,
  onClear,
  children,
}: {
  count: number;
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
  children: ReactNode;
}) {
  if (!count) return null;
  return (
    <div
      role="toolbar"
      aria-label="Selected rows"
      className="sticky top-14 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-accent bg-popover p-2 shadow-card"
    >
      <span className="px-2 text-sm text-text-primary">{count} selected</span>
      {children}
      {count < total && (
        <Button size="sm" variant="ghost" className="press-soft" onClick={onSelectAll}>
          Select all {total}
        </Button>
      )}
      <Button size="sm" variant="ghost" className="press-soft" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
