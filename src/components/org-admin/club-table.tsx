import type { ComponentProps } from "react";
import { Table } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function ClubTable({ className, ...props }: ComponentProps<typeof Table>) {
  return (
    <Table
      {...props}
      className={cn(
        "club-table border-separate border border-divider text-sm leading-relaxed text-text-primary [&_th]:border-b [&_th]:border-r [&_th]:border-divider [&_th]:px-4 [&_th]:py-3 [&_th]:text-left [&_th]:font-semibold [&_th]:text-text-primary [&_th:last-child]:border-r-0 [&_td]:border-b [&_td]:border-r [&_td]:border-divider/70 [&_td]:px-4 [&_td]:py-3 [&_td:last-child]:border-r-0 [&_tr]:h-12 [&_tbody_tr:last-child_td]:border-b-0 [&_tfoot]:font-semibold",
        className,
      )}
    />
  );
}
