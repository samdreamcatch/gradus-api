import type { ComponentProps } from "react";
import { Table } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function ClubTable({ className, ...props }: ComponentProps<typeof Table>) {
  return (
    <Table
      {...props}
      className={cn(
        "club-table border-collapse border border-divider text-foreground [&_th]:border [&_th]:border-divider [&_th]:bg-elevated [&_th]:px-3 [&_th]:text-foreground [&_td]:border [&_td]:border-divider [&_td]:px-3 [&_td]:py-2 [&_tr]:h-[38px] [&_tbody_tr:nth-child(even)]:bg-elevated/50 [&_tfoot]:bg-elevated [&_tfoot]:font-semibold",
        className,
      )}
    />
  );
}
