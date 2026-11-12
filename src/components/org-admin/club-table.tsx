import type { ComponentProps } from "react";
import { Table } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function ClubTable({ className, ...props }: ComponentProps<typeof Table>) {
  return (
    <div className="overflow-x-auto rounded-md border border-divider">
    <Table
      {...props}
      className={cn(
        "club-table border-separate text-sm font-sans text-text-primary [&_th]:h-11 [&_th]:border-b [&_th]:border-r [&_th]:border-divider [&_th]:px-3.5 [&_th]:py-0 [&_th]:font-sans [&_th]:text-xs [&_th]:font-semibold [&_th]:text-text-secondary [&_th:last-child]:border-r-0 [&_td]:whitespace-nowrap [&_td]:border-b [&_td]:border-r [&_td]:border-divider/70 [&_td]:px-3.5 [&_td]:py-2 [&_td:last-child]:border-r-0 [&_tr]:h-11 [&_tbody_tr:last-child_td]:border-b-0 [&_tfoot]:font-semibold",
        className,
      )}
    />
    </div>
  );
}
